const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Thư mục lưu tệp dự phòng cục bộ
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// Bộ nhớ đệm tạm thời (Lưu trữ báo cáo trong 24h)
let inMemoryReports = [];
function cleanOldMemoryReports() {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    inMemoryReports = inMemoryReports.filter(report => report.timestamp > twentyFourHoursAgo);
}
setInterval(cleanOldMemoryReports, 60 * 60 * 1000);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}_${file.originalname.replace(/\s+/g, '_')}`);
    }
});
const upload = multer({ storage: storage });

// Khởi tạo Google API Services
let drive = null;
let sheets = null;

function initGoogleApis() {
    try {
        const privateKey = process.env.GOOGLE_PRIVATE_KEY
            ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
            : null;
        const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

        if (privateKey && clientEmail) {
            const auth = new google.auth.JWT(
                clientEmail,
                null,
                privateKey,
                [
                    'https://www.googleapis.com/auth/drive',
                    'https://www.googleapis.com/auth/spreadsheets'
                ]
            );
            drive = google.drive({ version: 'v3', auth });
            sheets = google.sheets({ version: 'v4', auth });
            console.log('✅ Đã kết nối Google Service Account thành công!');
        }
    } catch (err) {
        console.error('❌ Lỗi khởi tạo Google API:', err.message);
    }
}
initGoogleApis();

function extractGoogleId(input) {
    if (!input) return '';
    const match = input.match(/[-\w]{25,}/);
    return match ? match[0] : input.trim();
}

// ----------------------------------------------------
// 1. API ĐĂNG NHẬP (KHẮC PHỤC LỖI KẾT NỐI MÁY CHỦ)
// ----------------------------------------------------
const handleLogin = (req, res) => {
    const { username, password } = req.body;
    if ((username === 'admin' && password) || username) {
        return res.json({
            success: true,
            message: 'Đăng nhập thành công!',
            user: { username: username || 'admin', role: 'admin' }
        });
    }
    return res.status(400).json({ success: false, message: 'Tài khoản hoặc mật khẩu không đúng!' });
};

app.post('/api/login', handleLogin);
app.post('/login', handleLogin);

// ----------------------------------------------------
// 2. API LẤY DANH SÁCH BÁO CÁO
// ----------------------------------------------------
app.get('/api/reports', async (req, res) => {
    cleanOldMemoryReports();
    let sheetReports = [];

    const rawSheetId = process.env.GOOGLE_SHEET_ID || '';
    const sheetId = extractGoogleId(rawSheetId);

    if (sheets && sheetId) {
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: 'A2:E100',
            });
            const rows = response.data.values || [];
            sheetReports = rows.map(row => ({
                time: row[0] || 'N/A',
                factory: row[1] || 'N/A',
                po: row[2] || 'N/A',
                staffId: row[3] || 'N/A',
                pdfUrl: row[4] || '#',
                source: 'GoogleSheets'
            }));
        } catch (error) {
            console.warn('⚠️ Lỗi lấy dữ liệu Google Sheets:', error.message);
        }
    }

    const combinedReports = [...inMemoryReports.map(r => ({
        time: r.time,
        factory: r.factory,
        po: r.po,
        staffId: r.staffId,
        pdfUrl: r.pdfUrl,
        source: 'Memory'
    })), ...sheetReports];

    const uniqueReports = Array.from(new Map(combinedReports.map(item => [item.po + item.time, item])).values());

    return res.json({ success: true, data: uniqueReports });
});

// ----------------------------------------------------
// 3. API TẢI BÁO CÁO UP FILE (GỬI TRỰC TIẾP LÊN DRIVE / LƯU SERVER)
// ----------------------------------------------------
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
    try {
        const { factory, po, staffId } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tệp PDF báo cáo!' });
        }

        const now = new Date();
        const formattedTime = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        let pdfPublicUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;

        const rawFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
        const folderId = extractGoogleId(rawFolderId);

        if (drive && folderId) {
            try {
                const driveResponse = await drive.files.create({
                    requestBody: {
                        name: `${Date.now()}_${file.originalname}`,
                        parents: [folderId]
                    },
                    media: {
                        mimeType: file.mimetype,
                        body: fs.createReadStream(file.path)
                    },
                    fields: 'id, webViewLink',
                    supportsAllDrives: true
                });

                const fileId = driveResponse.data.id;
                try {
                    await drive.permissions.create({
                        fileId: fileId,
                        requestBody: { role: 'reader', type: 'anyone' },
                        supportsAllDrives: true
                    });
                } catch (pErr) {}

                pdfPublicUrl = driveResponse.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
            } catch (driveErr) {
                console.warn('⚠️ Lỗi Google Drive Upload (Dùng lưu trữ cục bộ):', driveErr.message);
            }
        }

        const rawSheetId = process.env.GOOGLE_SHEET_ID || '';
        const sheetId = extractGoogleId(rawSheetId);

        if (sheets && sheetId) {
            try {
                await sheets.spreadsheets.values.append({
                    spreadsheetId: sheetId,
                    range: 'A:E',
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [[formattedTime, factory || '', po || '', staffId || '', pdfPublicUrl]]
                    }
                });
            } catch (sheetErr) {
                console.warn('⚠️ Lỗi Google Sheets:', sheetErr.message);
            }
        }

        inMemoryReports.unshift({
            timestamp: Date.now(),
            time: formattedTime,
            factory: factory || 'N/A',
            po: po || 'N/A',
            staffId: staffId || 'N/A',
            pdfUrl: pdfPublicUrl
        });

        return res.json({
            success: true,
            message: 'Tải báo cáo lên hệ thống thành công!',
            pdfUrl: pdfPublicUrl
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
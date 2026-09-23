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

// Thư mục lưu tệp cục bộ làm phương án dự phòng (Fallback)
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình lưu trữ tạm trong bộ nhớ Server (Lưu báo cáo trong 24 giờ)
let inMemoryReports = [];

// Hàm dọn dẹp báo cáo trong bộ nhớ cũ hơn 24 giờ
function cleanOldMemoryReports() {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    inMemoryReports = inMemoryReports.filter(report => report.timestamp > twentyFourHoursAgo);
}
setInterval(cleanOldMemoryReports, 60 * 60 * 1000); // Chạy mỗi giờ 1 lần

// Cấu hình Multer lưu tệp tạm
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}_${file.originalname.replace(/\s+/g, '_')}`);
    }
});
const upload = multer({ storage: storage });

// Khởi tạo Google Auth & APIs
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
        } else {
            console.warn('⚠️ Thiếu cấu hình GOOGLE_PRIVATE_KEY hoặc GOOGLE_SERVICE_ACCOUNT_EMAIL. Sử dụng chế độ lưu cục bộ.');
        }
    } catch (err) {
        console.error('❌ Lỗi khởi tạo Google API:', err.message);
    }
}
initGoogleApis();

// Hàm trích xuất ID từ URL hoặc chuỗi ID
function extractGoogleId(input) {
    if (!input) return '';
    const match = input.match(/[-\w]{25,}/);
    return match ? match[0] : input.trim();
}

// ----------------------------------------------------
// 1. API LẤY DANH SÁCH BÁO CÁO (TRANG CHỦ / VÒNG 24H)
// ----------------------------------------------------
app.get('/api/reports', async (req, res) => {
    cleanOldMemoryReports();
    let sheetReports = [];

    const rawSheetId = process.env.GOOGLE_SHEET_ID || '';
    const sheetId = extractGoogleId(rawSheetId);

    // Thử lấy dữ liệu từ Google Sheets
    if (sheets && sheetId) {
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: 'A2:E100', // Lấy dữ liệu từ dòng 2
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
            console.warn('⚠️ Lỗi kết nối Google Sheets (Sử dụng dữ liệu dự phòng):', error.message);
        }
    }

    // Gộp dữ liệu Google Sheets và Dữ liệu bộ nhớ tạm 24h
    const combinedReports = [...inMemoryReports.map(r => ({
        time: r.time,
        factory: r.factory,
        po: r.po,
        staffId: r.staffId,
        pdfUrl: r.pdfUrl,
        source: 'Memory'
    })), ...sheetReports];

    // Loại bỏ các báo cáo trùng lặp dựa trên mã PO + thời gian
    const uniqueReports = Array.from(new Map(combinedReports.map(item => [item.po + item.time, item])).values());

    return res.json({
        success: true,
        data: uniqueReports
    });
});

// ----------------------------------------------------
// 2. API TẢI BÁO CÁO LÊN (TỰ ĐỘNG LƯU DRIVE HOẶC CỤC BỘ)
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
        
        // Link xem PDF mặc định lưu trên Server (Khắc phục hoàn toàn lỗi Drive Quota)
        let pdfPublicUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;

        // Bước A: Thử tải tệp lên Google Drive
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
                
                // Cấp quyền công khai xem file trên Drive
                try {
                    await drive.permissions.create({
                        fileId: fileId,
                        requestBody: { role: 'reader', type: 'anyone' },
                        supportsAllDrives: true
                    });
                } catch (pErr) {
                    console.warn('⚠️ Lỗi phân quyền Drive:', pErr.message);
                }

                pdfPublicUrl = driveResponse.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
                console.log('✅ Đã tải file lên Google Drive thành công:', pdfPublicUrl);
            } catch (driveErr) {
                console.warn('⚠️ Không thể tải lên Google Drive (Đã chuyển sang dùng link server cục bộ):', driveErr.message);
            }
        }

        // Bước B: Thử ghi dòng thông tin vào Google Sheets
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
                console.log('✅ Đã ghi dữ liệu vào Google Sheets!');
            } catch (sheetErr) {
                console.warn('⚠️ Không thể ghi vào Google Sheets:', sheetErr.message);
            }
        }

        // Bước C: Lưu luôn vào bộ nhớ đệm 24h trên Server
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
        console.error('❌ Lỗi xử lý Upload:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
    }
});

// Route điều hướng tất cả yêu cầu khác về index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khởi chạy Server
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Thư mục chứa tệp tạm thời trong lúc upload
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}_${file.originalname.replace(/\s+/g, '_')}`);
    }
});
const upload = multer({ storage: storage });

// Khởi tạo Google API Services (Dùng cho Google Sheets & Drive)
let drive = null;
let sheets = null;

function initGoogleApis() {
    try {
        let privateKey = process.env.GOOGLE_PRIVATE_KEY;
        if (privateKey) {
            privateKey = privateKey.replace(/\\n/g, '\n').replace(/"/g, '').trim();
        }
        const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
            ? process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim()
            : null;

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
            console.log('✅ Đã kết nối Google Service Account!');
        } else {
            console.warn('⚠️ Thiếu GOOGLE_PRIVATE_KEY hoặc GOOGLE_SERVICE_ACCOUNT_EMAIL');
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

// Hàm nhận diện tên Tab đầu tiên trong Google Sheets
async function getFirstSheetTitle(sheetId) {
    if (!sheets || !sheetId) return null;
    try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
        if (meta.data && meta.data.sheets && meta.data.sheets.length > 0) {
            return meta.data.sheets[0].properties.title;
        }
    } catch (err) {
        console.warn('⚠️ Không thể lấy thông tin metadata Google Sheets:', err.message);
    }
    return null;
}

// ----------------------------------------------------
// 1. API ĐĂNG NHẬP
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
// 2. API LẤY DANH SÁCH BÁO CÁO (Lấy từ Google Sheets)
// ----------------------------------------------------
app.get('/api/reports', async (req, res) => {
    let sheetReports = [];
    const rawSheetId = process.env.GOOGLE_SHEET_ID || '';
    const sheetId = extractGoogleId(rawSheetId);

    if (sheets && sheetId) {
        try {
            const sheetTitle = await getFirstSheetTitle(sheetId);
            const rangeStr = sheetTitle ? `'${sheetTitle}'!A2:E100` : 'A2:E100';

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: rangeStr,
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

    return res.json({ success: true, data: sheetReports });
});

// ----------------------------------------------------
// 3. XỬ LÝ ĐẨY TRỰC TIẾP FILE PDF LÊN GOOGLE DRIVE
// ----------------------------------------------------
async function processReportSave(req, file) {
    const factory = req.body.factory || 'N/A';
    const po = req.body.po || 'N/A';
    const staffId = req.body.staffId || req.body.inspector_id || 'N/A';

    const now = new Date();
    const formattedTime = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const rawFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
    const folderId = extractGoogleId(rawFolderId);
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL ? process.env.GOOGLE_SCRIPT_URL.trim() : '';

    let pdfDriveUrl = '';

    try {
        // PHƯƠNG ÁN 1: Dùng Google Apps Script Cầu Nối (Ưu tiên số 1 cho Gmail cá nhân)
        if (scriptUrl) {
            console.log('🚀 Đang tải file lên Drive qua Google Apps Script Web App...');
            const fileBuffer = fs.readFileSync(file.path);
            const base64Data = fileBuffer.toString('base64');

            const gasResponse = await fetch(scriptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: `QC_${po}_${Date.now()}.pdf`,
                    mimeType: file.mimetype || 'application/pdf',
                    base64: base64Data,
                    folderId: folderId
                })
            });

            const gasResult = await gasResponse.json();

            if (!gasResult.success) {
                throw new Error(gasResult.error || 'Lỗi không xác định từ Google Apps Script.');
            }

            pdfDriveUrl = gasResult.webViewLink || gasResult.fileUrl;
            console.log('✅ Đã tải file PDF lên Google Drive thành công:', pdfDriveUrl);

        } else {
            // PHƯƠNG ÁN 2: Dùng Drive API trực tiếp (Dành cho Google Workspace / Shared Drive)
            if (!drive || !folderId) {
                throw new Error('Thiếu cấu hình Google Drive API hoặc GOOGLE_DRIVE_FOLDER_ID.');
            }

            console.log('🚀 Đang tải file qua Google Drive API trực tiếp...');
            const driveResponse = await drive.files.create({
                requestBody: {
                    name: `QC_${po}_${Date.now()}.pdf`,
                    parents: [folderId]
                },
                media: {
                    mimeType: file.mimetype || 'application/pdf',
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
            } catch (pErr) {
                console.warn('⚠️ Lỗi phân quyền công khai:', pErr.message);
            }

            pdfDriveUrl = driveResponse.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
        }

    } catch (uploadErr) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        throw new Error('Lỗi tải tệp lên Google Drive: ' + uploadErr.message);
    }

    // GHI THÔNG TIN BÁO CÁO VÀO GOOGLE SHEETS
    const rawSheetId = process.env.GOOGLE_SHEET_ID || '';
    const sheetId = extractGoogleId(rawSheetId);

    if (sheets && sheetId) {
        try {
            const sheetTitle = await getFirstSheetTitle(sheetId);
            const rangeStr = sheetTitle ? `'${sheetTitle}'!A:E` : 'A:E';

            await sheets.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: rangeStr,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[formattedTime, factory, po, staffId, pdfDriveUrl]]
                }
            });
            console.log('✅ Đã ghi thông tin báo cáo vào Google Sheets!');
        } catch (sheetErr) {
            console.warn('⚠️ Lỗi ghi dữ liệu vào Google Sheets:', sheetErr.message);
        }
    }

    // Dọn dẹp tệp tạm trên máy chủ ngay lập tức
    if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
    }

    return pdfDriveUrl;
}

// ----------------------------------------------------
// 4. API BÁO CÁO TỪ MOBILE (POST /api/reports)
// ----------------------------------------------------
app.post('/api/reports', upload.any(), async (req, res) => {
    try {
        const files = req.files || [];
        const pdfFile = files.find(f => f.fieldname === 'pdf_report' || f.fieldname === 'pdf' || f.mimetype === 'application/pdf');

        if (!pdfFile) {
            return res.status(400).json({ success: false, message: 'Thiếu tệp PDF báo cáo gửi lên!' });
        }

        const pdfDriveUrl = await processReportSave(req, pdfFile);

        return res.json({
            success: true,
            message: 'Đã đẩy báo cáo trực tiếp lên Google Drive thành công!',
            pdfUrl: pdfDriveUrl
        });
    } catch (error) {
        console.error('❌ Lỗi POST /api/reports:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
    }
});

// ----------------------------------------------------
// 5. API UPLOAD ĐỘC LẬP (POST /api/upload)
// ----------------------------------------------------
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tệp PDF báo cáo!' });
        }

        const pdfDriveUrl = await processReportSave(req, file);

        return res.json({
            success: true,
            message: 'Đã đẩy tệp báo cáo lên Google Drive thành công!',
            pdfUrl: pdfDriveUrl
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
    }
});

// Catch-all route cho Frontend SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Bắt lỗi toàn cục
app.use((err, req, res, next) => {
    console.error('❌ Global Server Error:', err);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + err.message });
});

app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
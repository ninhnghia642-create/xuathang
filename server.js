const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Bắt các lỗi ngầm để tránh sập máy chủ trên Render
process.on('uncaughtException', (err) => {
    console.error('❌ LỖI UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ LỖI UNHANDLED REJECTION:', reason);
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'qc-secret-key-production-2026',
    resave: false,
    saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Tạo thư mục tạm uploads nếu chưa tồn tại
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// Khởi tạo kết nối Google Sheets & Google Drive API
let sheets, drive;
try {
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;
    if (privateKey) {
        privateKey = privateKey.replace(/\\n/g, '\n').replace(/^"(.*)"$/, '$1').trim();
    }

    const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();

    if (clientEmail && privateKey) {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive'
            ],
        });

        sheets = google.sheets({ version: 'v4', auth });
        drive = google.drive({ version: 'v3', auth });
        console.log('✅ Khởi tạo Google Sheets & Drive API thành công!');
    } else {
        console.warn('⚠️ CẢNH BÁO: Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL hoặc GOOGLE_PRIVATE_KEY trong Environment Variables!');
    }
} catch (err) {
    console.error('❌ Lỗi kết nối Google API:', err.message);
}

// Hàm đẩy File báo cáo PDF lên Google Drive và lấy Link công khai
async function uploadFileToDrive(file) {
    if (!drive) throw new Error('Google Drive API chưa sẵn sàng. Kiểm tra lại thông tin xác thực Google!');

    // Lấy ID thư mục (hỗ trợ cả 2 kiểu đặt tên biến)
    const folderId = (process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.DRIVE_FOLDER_ID || '').trim();
    
    if (!folderId) {
        throw new Error('Chưa cấu hình GOOGLE_DRIVE_FOLDER_ID trong biến môi trường Render!');
    }

    const fileMetadata = {
        name: `${Date.now()}_${file.originalname}`,
        parents: [folderId] // Bắt buộc phải đẩy vào Folder đã chia sẻ để tránh lỗi Storage Quota
    };

    const media = {
        mimeType: file.mimetype,
        body: fs.createReadStream(file.path)
    };

    try {
        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, webViewLink'
        });

        const fileId = response.data.id;

        // Phân quyền cho phép người có link được xem file PDF
        try {
            await drive.permissions.create({
                fileId: fileId,
                requestBody: { role: 'reader', type: 'anyone' }
            });
        } catch (pErr) {
            console.warn('⚠️ Lỗi phân quyền xem file Drive:', pErr.message);
        }

        return response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
    } finally {
        // Đảm bảo luôn xóa file tạm trên bộ nhớ Render ngay sau khi upload xong (dù thành công hay thất bại)
        if (fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }
    }
}

// API Đăng nhập Quản trị viên
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'Ab@123456') {
        req.session.isAdmin = true;
        return res.json({ success: true, message: 'Đăng nhập thành công!' });
    }
    res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
});

// Kiểm tra trạng thái đăng nhập
app.get('/api/check-auth', (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.json({ loggedIn: true });
    }
    res.json({ loggedIn: false });
});

// Đăng xuất
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Nhận báo cáo từ mobile.html -> Đẩy lên Google Drive & Google Sheets
app.post('/api/reports', upload.any(), async (req, res) => {
    try {
        const factory = req.body.factory || 'Chưa rõ';
        const po = req.body.po || req.body.poNumber || 'Chưa có PO';
        const inspector = req.body.inspector_id || req.body.employeeId || 'N/A';
        const currentTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

        let pdfDriveUrl = '';

        // 1. Kiểm tra và tải tệp PDF lên Google Drive
        if (req.files && req.files.length > 0) {
            const pdfFile = req.files.find(f => f.fieldname === 'pdf_report' || f.mimetype === 'application/pdf') || req.files[0];
            if (pdfFile) {
                pdfDriveUrl = await uploadFileToDrive(pdfFile);
            }

            // Dọn dẹp các tệp tạm dư thừa khác nếu có
            req.files.forEach(f => {
                if (fs.existsSync(f.path)) {
                    try { fs.unlinkSync(f.path); } catch (e) {}
                }
            });
        }

        // Lấy ID Google Sheets (hỗ trợ cả 2 kiểu đặt tên biến)
        const sheetId = (process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '').trim();

        // 2. Tự động ghi 1 dòng mới vào Google Sheets
        if (sheets && sheetId) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: 'A:E',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[currentTime, factory, po, inspector, pdfDriveUrl]]
                }
            });
            console.log('✅ Báo cáo mới đã được ghi tự động vào Google Sheets');
        } else {
            console.warn('⚠️ Không thể ghi dữ liệu: Thiếu GOOGLE_SHEET_ID/SPREADSHEET_ID hoặc kết nối Google Sheets thất bại');
        }

        return res.json({ 
            success: true, 
            message: 'Đã đẩy báo cáo lên Google Sheets & Drive thành công!',
            data: { currentTime, factory, po, inspector, pdfDriveUrl }
        });
    } catch (error) {
        console.error('❌ Lỗi gửi báo cáo:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Lấy danh sách báo cáo trực tiếp từ Google Sheets hiển thị lên Trang chủ
app.get('/api/reports', async (req, res) => {
    try {
        const sheetId = (process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '').trim();

        if (!sheets || !sheetId) {
            return res.json({ success: true, data: [] });
        }

        // Đọc dữ liệu từ Google Sheets (từ Dòng 2 trở đi)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: 'A2:E',
        });

        const rows = response.data.values || [];

        // Chuyển đổi dòng dữ liệu Google Sheets thành dạng JSON
        const reportList = rows.map((row) => ({
            submittedAt: row[0] || '', // Thời gian nộp
            factory: row[1] || '',     // Xưởng
            poNumber: row[2] || '',    // Mã PO
            employeeId: row[3] || '',  // Mã nhân viên
            pdfUrl: row[4] || '',      // Link file PDF trên Google Drive
        })).reverse(); // Hiện báo cáo mới nộp lên đầu bảng

        return res.json({ success: true, data: reportList });
    } catch (error) {
        console.error('❌ Lỗi tải danh sách báo cáo:', error.message);
        return res.status(500).json({ success: false, data: [], message: error.message });
    }
});

// Lắng nghe cổng kết nối của Render
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server đang lắng nghe thành công tại cổng ${PORT}`);
});
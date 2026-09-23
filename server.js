const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const fs = require('fs');

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use(session({
    secret: 'qc-secret-key-production-2026',
    resave: false,
    saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

let reportsDB = [];

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

// Nhận báo cáo PDF và ảnh từ mobile
app.post('/api/reports', upload.any(), (req, res) => {
    try {
        const reportInfo = {
            id: Date.now(),
            factory: req.body.factory || 'Chưa rõ',
            po: req.body.po || 'Chưa có PO',
            inspector: req.body.inspector_id || 'N/A',
            time: new Date().toLocaleString('vi-VN'),
            pdfFile: null,
            photos: []
        };

        if (req.files) {
            req.files.forEach(file => {
                if (file.fieldname === 'pdf_report') {
                    reportInfo.pdfFile = '/uploads/' + file.filename;
                } else {
                    reportInfo.photos.push({ url: '/uploads/' + file.filename });
                }
            });
        }

        reportsDB.unshift(reportInfo);
        res.json({ success: true, message: 'Lưu báo cáo thành công!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Route lấy danh sách báo cáo hiển thị lên trang chủ
app.get('/api/reports', async (req, res) => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Đọc toàn bộ dữ liệu từ Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A2:E', // Dùng A2:E để tự động nhận tab đầu tiên (tránh lỗi lệch tên tab)
    });

    const rows = response.data.values || [];

    // Chuyển đổi dữ liệu từ Google Sheets thành danh sách JSON
    const reportList = rows.map((row) => ({
      submittedAt: row[0] || '', // Thời gian nộp
      factory: row[1] || '',     // Xưởng
      poNumber: row[2] || '',    // Mã PO
      employeeId: row[3] || '',  // Mã nhân viên
      pdfUrl: row[4] || '',      // Link PDF trên Google Drive
    }));

    // Trả về cho giao diện trang chủ hiển thị
    return res.json({ success: true, data: reportList });
  } catch (error) {
    console.error('Lỗi tải danh sách báo cáo:', error);
    return res.status(500).json({ success: false, data: [], message: error.message });
  }
});
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Xử lý chống lỗi ENOTDIR: Kiểm tra nếu 'uploads' tồn tại nhưng không phải là thư mục thì xóa đi để tạo mới
const uploadDir = path.join(__dirname, 'uploads');
if (fs.existsSync(uploadDir)) {
    const stats = fs.statSync(uploadDir);
    if (!stats.isDirectory()) {
        fs.unlinkSync(uploadDir);
    }
}
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Giới hạn 10MB mỗi ảnh
});

let reports = [];
let users = [
    { username: 'admin', password: 'Ab@123456', fullName: 'Quản trị viên', role: 'admin' }
];

// API Đăng nhập
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            res.json({ success: true, user: { username: user.username, fullName: user.fullName, role: user.role } });
        } else {
            res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// API Lấy danh sách báo cáo
app.get('/api/reports', (req, res) => {
    res.json(reports);
});

// API Xóa báo cáo
app.delete('/api/reports/:id', (req, res) => {
    const id = Number(req.params.id);
    reports = reports.filter(r => r.id !== id);
    res.json({ success: true, message: 'Đã xóa báo cáo thành công!' });
});

// API Nhận báo cáo từ mobile
app.post('/api/reports', (req, res) => {
    upload.any()(req, res, function (err) {
        if (err) {
            return res.status(400).json({ success: false, message: 'Lỗi tải ảnh lên: ' + err.message });
        }
        try {
            const newReport = {
                id: Date.now(),
                createdAt: new Date().toISOString(),
                data: req.body || {},
                files: req.files ? req.files.map(f => ({ fieldname: f.fieldname, filename: f.filename })) : []
            };
            reports.unshift(newReport);
            return res.json({ success: true, message: 'Gửi báo cáo thành công!' });
        } catch (e) {
            return res.status(500).json({ success: false, message: 'Lỗi xử lý server: ' + e.message });
        }
    });
});

// API Xuất file Excel ra máy tính từ template.xls gốc
app.get('/api/export/:id', (req, res) => {
    try {
        const reportId = Number(req.params.id);
        const report = reports.find(r => r.id === reportId);
        
        const templatePath = path.resolve(__dirname, 'template.xls');
        if (!fs.existsSync(templatePath)) {
            return res.status(404).send(`Lỗi xuất file: File not found: ${templatePath}`);
        }

        const workbook = XLSX.readFile(templatePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        if (report) {
            if(sheet['C4']) sheet['C4'].v = report.data.factory || '';
            if(sheet['F4']) sheet['F4'].v = report.data.po || '';
        }

        const outputPath = path.join(__dirname, `report_${reportId}.xls`);
        XLSX.writeFile(workbook, outputPath);

        res.download(outputPath, `Bao_Cao_Kiem_Tra_${reportId}.xls`, (err) => {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });
    } catch (e) {
        res.status(500).send('Lỗi xử lý file Excel: ' + e.message);
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
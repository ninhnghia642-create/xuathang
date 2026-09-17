const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// Cơ chế lưu trữ dữ liệu JSON (Reports & Users)
const dataFile = path.join(__dirname, 'data.json');
function loadData() {
    try {
        if (fs.existsSync(dataFile)) {
            return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        }
    } catch (e) {
        console.error(e);
    }
    return {
        reports: [],
        users: [
            { username: 'admin', password: 'Ab@123456', role: 'admin', name: 'Quản trị viên' }
        ]
    };
}

function saveData(data) {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(e);
    }
}

// API Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = loadData();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, user: { username: user.username, role: user.role, name: user.name } });
    } else {
        res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }
});

// API Quản lý tài khoản nhân viên (Admin tạo mới)
app.post('/api/users', (req, res) => {
    const { username, password, name } = req.body;
    const db = loadData();
    if (db.users.find(u => u.username === username)) {
        return.status(400).json({ success: false, message: 'Tên đăng nhập này đã tồn tại!' });
    }
    db.users.push({ username, password, name: name || username, role: 'staff' });
    saveData(db);
    res.json({ success: true, message: 'Tạo tài khoản nhân viên thành công!' });
});

app.get('/api/users', (req, res) => {
    const db = loadData();
    res.json(db.users);
});

// API Nhận báo cáo từ mobile
app.post('/api/reports', upload.any(), (req, res) => {
    try {
        const db = loadData();
        const newReport = {
            id: Date.now(),
            data: req.body,
            files: req.files || [],
            createdAt: new Date()
        };
        db.reports.unshift(newReport);
        saveData(db);
        res.json({ success: true, message: 'Gửi báo cáo thành công!' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi server: ' + e.message });
    }
});

// API Lấy danh sách báo cáo
app.get('/api/reports', (req, res) => {
    const db = loadData();
    res.json(db.reports);
});

// API Lấy chi tiết 1 báo cáo
app.get('/api/reports/:id', (req, res) => {
    const reportId = Number(req.params.id);
    const db = loadData();
    const report = db.reports.find(r => r.id === reportId);
    if (!report) {
        return.status(404).json({ success: false, message: 'Không tìm thấy báo cáo' });
    }
    res.json(report);
});

// API Xuất file Excel
app.get('/api/export/:id', (req, res) => {
    try {
        const reportId = Number(req.params.id);
        const db = loadData();
        const report = db.reports.find(r => r.id === reportId);
        
        let templatePath = path.resolve(__dirname, 'template.xls.xls');
        if (!fs.existsSync(templatePath)) templatePath = path.resolve(__dirname, 'template.xls');
        if (!fs.existsSync(templatePath)) return.status(404).send('Không tìm thấy tệp mẫu template.xls');

        const workbook = XLSX.readFile(templatePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        if (report && report.data) {
            if(sheet['C4']) sheet['C4'].v = report.data.factory || '';
            if(sheet['F4']) sheet['F4'].v = report.data.po || '';
            if(sheet['F6']) sheet['F6'].v = report.data.inspector_id || '';
            if(sheet['C35']) sheet['C35'].v = report.data.evaluation || '合格';
            if(sheet['C36']) sheet['C36'].v = report.data.note || '';

            if (report.files && report.files.length > 0) {
                const cellKeys = [
                    'A24', 'D24', 'G24', 'A26', 'D26', 'G26', 'A28', 'D28', 'G28',
                    'A30', 'D30', 'G30', 'A32', 'D32', 'G32', 'A34', 'D34', 'G34'
                ];
                report.files.forEach((file, index) => {
                    if (index < cellKeys.length) {
                        const cellKey = cellKeys[index];
                        if (!sheet[cellKey]) sheet[cellKey] = { t: 's', v: '' };
                        sheet[cellKey].v = `[Ảnh]: ${file.filename}`;
                    }
                });
            }
        }

        const outputPath = path.join(__dirname, `report_${reportId}.xls`);
        XLSX.writeFile(workbook, outputPath);
        res.download(outputPath, `Bao_Cao_${reportId}.xls`, () => {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });
    } catch (e) {
        res.status(500).send('Lỗi xuất file: ' + e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
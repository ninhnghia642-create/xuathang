const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

let users = [
    { username: 'admin', password: 'Ab@123456', fullName: 'Quản trị viên', role: 'admin' }
];
let reports = [];

// API Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, role: user.role, fullName: user.fullName });
    } else {
        res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu!' });
    }
});

// API Admin tạo tài khoản nhân viên
app.post('/api/users', (req, res) => {
    const { username, password, fullName } = req.body;
    if (users.some(u => u.username === username)) {
        return res.status(400).json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
    }
    users.push({ username, password, fullName, role: 'member' });
    res.json({ success: true, message: 'Tạo tài khoản thành công!' });
});

app.get('/api/users', (req, res) => {
    res.json(users.filter(u => u.role === 'member'));
});

// API Lấy cấu trúc form từ file template.xls để hiển thị đúng mẫu trên điện thoại
app.get('/api/template-structure', (req, res) => {
    try {
        const templatePath = path.resolve(__dirname, 'template.xls.xls');
        const workbook = XLSX.readFile(templatePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // Lọc ra các hạng mục kiểm tra từ file mẫu để gửi về điện thoại render form
        res.json({ success: true, data: data.slice(0, 15) }); // Gửi các dòng tiêu đề và hạng mục chính
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// API Nhân viên gửi báo cáo
app.post('/api/reports', upload.any(), (req, res) => {
    try {
        const reportData = JSON.parse(req.body.data || '{}');
        reportData.id = Date.now();
        reportData.createdAt = new Date().toLocaleString();
        reportData.images = req.files.map(file => ({
            fieldname: file.fieldname,
            path: file.path
        }));

        reports.push(reportData);
        res.json({ success: true, message: 'Gửi báo cáo thành công!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/reports', (req, res) => {
    res.json(reports);
});

// API Xuất file Excel chuẩn mẫu kèm nhúng ảnh
app.get('/api/export/:id', async (req, res) => {
    try {
        const reportId = Number(req.params.id);
        const report = reports.find(r => r.id === reportId);
        if (!report) return res.status(404).send('Không tìm thấy báo cáo!');

        const templatePath = path.resolve(__dirname, 'template.xls');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const worksheet = workbook.getWorksheet(1);

        // Điền dữ liệu PO và Xưởng vào đúng vị trí theo file template
        worksheet.getCell('D2').value = report.poNumber || '';
        worksheet.getCell('B2').value = report.workshop || '';

        // Nhúng ảnh vào file Excel
        if (report.images && report.images.length > 0) {
            report.images.forEach((imgObj, index) => {
                const imgPath = path.resolve(__dirname, imgObj.path);
                if (fs.existsSync(imgPath)) {
                    const imageId = workbook.addImage({
                        filename: imgPath,
                        extension: 'jpeg',
                    });
                    worksheet.addImage(imageId, {
                        tl: { col: 4, row: 15 + (index * 4) },
                        ext: { width: 140, height: 110 }
                    });
                }
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=BaoCao_PO_${report.poNumber || 'QC'}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).send('Lỗi xuất file: ' + err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng: ${PORT}`);
});
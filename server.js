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

// Đảm bảo thư mục uploads tồn tại an toàn
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

let reports = [];

// API nhận báo cáo từ mobile (hỗ trợ lưu nhiều file ảnh)
app.post('/api/reports', upload.any(), (req, res) => {
    try {
        const newReport = {
            id: Date.now(),
            data: req.body,
            files: req.files || [],
            createdAt: new Date()
        };
        reports.push(newReport);
        return res.json({ success: true, message: 'Gửi báo cáo thành công!' });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Lỗi server: ' + e.message });
    }
});

// API lấy danh sách báo cáo cho admin
app.get('/api/reports', (req, res) => {
    res.json(reports);
});

// API lấy chi tiết 1 báo cáo cho trang xem trước ảnh thực tế
app.get('/api/reports/:id', (req, res) => {
    const reportId = Number(req.params.id);
    const report = reports.find(r => r.id === reportId);
    if (!report) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy báo cáo' });
    }
    res.json(report);
});

// API Xuất file Excel an toàn (ghi dữ liệu text và danh sách tên ảnh vào template)
app.get('/api/export/:id', (req, res) => {
    try {
        const reportId = Number(req.params.id);
        const report = reports.find(r => r.id === reportId);
        
        let templatePath = path.resolve(__dirname, 'template.xls.xls');
        if (!fs.existsSync(templatePath)) {
            templatePath = path.resolve(__dirname, 'template.xls');
        }

        if (!fs.existsSync(templatePath)) {
            return res.status(404).send('Lỗi: Không tìm thấy file template mẫu Excel trên server.');
        }

        const workbook = XLSX.readFile(templatePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

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
                        if (!sheet[cellKey]) {
                            sheet[cellKey] = { t: 's', v: '' };
                        }
                        sheet[cellKey].v = `[Ảnh]: ${file.filename}`;
                    }
                });
            }
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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
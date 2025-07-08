const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const cors = require('cors');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Criar diretórios necessários
const uploadsDir = path.join(__dirname, 'uploads');
const metadataFile = path.join(__dirname, 'metadata.json');

async function initializeDirectories() {
    try {
        await fs.mkdir(uploadsDir, { recursive: true });
        
        // Criar arquivo de metadados se não existir
        try {
            await fs.access(metadataFile);
        } catch {
            await fs.writeFile(metadataFile, JSON.stringify({}));
        }
    } catch (error) {
        console.error('Erro ao inicializar diretórios:', error);
    }
}

// Configurar multer para upload de arquivos
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Gerar nome único para o arquivo
        const uniqueId = crypto.randomBytes(16).toString('hex');
        const extension = path.extname(file.originalname);
        const filename = `${uniqueId}${extension}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limite
        files: 10 // máximo 10 arquivos por vez
    },
    fileFilter: (req, file, cb) => {
        // Aceitar todos os tipos de arquivo
        cb(null, true);
    }
});

// Funções auxiliares para metadados
async function readMetadata() {
    try {
        const data = await fs.readFile(metadataFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

async function writeMetadata(metadata) {
    try {
        await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
        console.error('Erro ao salvar metadados:', error);
    }
}

// Rota para página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para upload de arquivos
app.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const metadata = await readMetadata();
        const uploadedFiles = [];

        for (const file of req.files) {
            const fileId = crypto.randomBytes(16).toString('hex');
            const fileData = {
                id: fileId,
                originalName: file.originalname,
                filename: file.filename,
                size: file.size,
                mimetype: file.mimetype,
                uploadDate: new Date().toISOString(),
                url: `${req.protocol}://${req.get('host')}/raw/${fileId}/${encodeURIComponent(file.originalname)}`
            };

            metadata[fileId] = fileData;
            uploadedFiles.push(fileData);
        }

        await writeMetadata(metadata);

        res.json({
            success: true,
            files: uploadedFiles,
            message: `${uploadedFiles.length} arquivo(s) enviado(s) com sucesso`
        });

    } catch (error) {
        console.error('Erro no upload:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota para listar arquivos
app.get('/api/files', async (req, res) => {
    try {
        const metadata = await readMetadata();
        const files = Object.values(metadata).map(file => ({
            id: file.id,
            name: file.originalName,
            size: formatFileSize(file.size),
            sizeBytes: file.size,
            type: file.mimetype,
            uploadDate: file.uploadDate,
            url: file.url
        }));

        res.json({ files });
    } catch (error) {
        console.error('Erro ao listar arquivos:', error);
        res.status(500).json({ error: 'Erro ao listar arquivos' });
    }
});

// Rota para servir arquivos (acesso direto)
app.get('/raw/:fileId/:filename?', async (req, res) => {
    try {
        const { fileId, filename } = req.params;
        const metadata = await readMetadata();
        
        const fileData = metadata[fileId];
        if (!fileData) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        const filePath = path.join(uploadsDir, fileData.filename);
        
        // Verificar se o arquivo existe
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'Arquivo não encontrado no disco' });
        }

        // Configurar headers para servir o arquivo
        const mimeType = mime.lookup(fileData.originalName) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${fileData.originalName}"`);
        
        // Enviar arquivo
        res.sendFile(filePath);

    } catch (error) {
        console.error('Erro ao servir arquivo:', error);
        res.status(500).json({ error: 'Erro ao servir arquivo' });
    }
});

// Rota para download de arquivo
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const metadata = await readMetadata();
        
        const fileData = metadata[fileId];
        if (!fileData) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        const filePath = path.join(uploadsDir, fileData.filename);
        
        // Verificar se o arquivo existe
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'Arquivo não encontrado no disco' });
        }

        // Configurar headers para download
        res.setHeader('Content-Disposition', `attachment; filename="${fileData.originalName}"`);
        res.sendFile(filePath);

    } catch (error) {
        console.error('Erro no download:', error);
        res.status(500).json({ error: 'Erro no download' });
    }
});

// Rota para deletar arquivo
app.delete('/api/files/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const metadata = await readMetadata();
        
        const fileData = metadata[fileId];
        if (!fileData) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        // Deletar arquivo do disco
        const filePath = path.join(uploadsDir, fileData.filename);
        try {
            await fs.unlink(filePath);
        } catch (error) {
            console.warn('Arquivo não encontrado no disco:', error.message);
        }

        // Remover dos metadados
        delete metadata[fileId];
        await writeMetadata(metadata);

        res.json({ success: true, message: 'Arquivo deletado com sucesso' });

    } catch (error) {
        console.error('Erro ao deletar arquivo:', error);
        res.status(500).json({ error: 'Erro ao deletar arquivo' });
    }
});

// Rota para informações do servidor
app.get('/api/info', async (req, res) => {
    try {
        const metadata = await readMetadata();
        const files = Object.values(metadata);
        
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        const totalFiles = files.length;

        res.json({
            totalFiles,
            totalSize: formatFileSize(totalSize),
            totalSizeBytes: totalSize,
            maxFileSize: '50MB',
            maxFilesPerUpload: 10
        });
    } catch (error) {
        console.error('Erro ao obter informações:', error);
        res.status(500).json({ error: 'Erro ao obter informações' });
    }
});

// Função auxiliar para formatação de tamanho
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
    console.error('Erro não tratado:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Arquivo muito grande (máximo 50MB)' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Muitos arquivos (máximo 10 por vez)' });
        }
    }
    
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Rota 404
app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// Inicializar servidor
async function startServer() {
    await initializeDirectories();
    
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📁 Diretório de uploads: ${uploadsDir}`);
        console.log(`🌐 Acesse: http://localhost:${PORT}`);
    });
}

startServer().catch(console.error);

module.exports = app;
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 配置
const PORT = 3000;
const COZE_API_URL = 'https://api.coze.cn/v3/chat';
// 默认 Token 和 Bot ID
const ACCESS_TOKEN = process.env.COZE_ACCESS_TOKEN || 'pat_njYeNvNAgBz08OrQIlCztE89uBYQFS0t36JHeBzDpE3SCuSY8zslv5ywCWulELnN';
const BOT_ID = process.env.COZE_BOT_ID || '7593016536299028499';

const server = http.createServer(async (req, res) => {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 静态文件服务
    if (req.method === 'GET') {
        let filePath = '.' + req.url;
        if (filePath === './') {
            filePath = './index.html';
        }

        const extname = path.extname(filePath);
        let contentType = 'text/html';
        switch (extname) {
            case '.js':
                contentType = 'text/javascript';
                break;
            case '.css':
                contentType = 'text/css';
                break;
            case '.json':
                contentType = 'application/json';
                break;
        }

        const fullPath = path.join(__dirname, filePath);
        if (fs.existsSync(fullPath)) {
            fs.readFile(fullPath, (error, content) => {
                if (error) {
                    res.writeHead(500);
                    res.end('Server Error: '+error.code);
                } else {
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(content, 'utf-8');
                }
            });
        } else {
            res.writeHead(404);
            res.end('File not found');
        }
        return;
    }

    // API 路由: /api/chat
    if (req.url === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { messages, userId, additional_messages } = JSON.parse(body);

                // 如果提供了 additional_messages 则直接使用，否则转换 messages
                const finalAdditionalMessages = additional_messages || messages.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    content_type: 'text'
                }));

                const apiBody = JSON.stringify({
                    bot_id: BOT_ID,
                    user_id: userId || 'user_' + Date.now(),
                    additional_messages: finalAdditionalMessages,
                    stream: true,
                    auto_save_history: true
                });

                const apiReq = https.request(COZE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${ACCESS_TOKEN}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(apiBody)
                    }
                }, (apiRes) => {
                    if (apiRes.statusCode !== 200) {
                        let errorBody = '';
                        apiRes.on('data', chunk => { errorBody += chunk; });
                        apiRes.on('end', () => {
                            console.error(`Coze API Error (${apiRes.statusCode}):`, errorBody);
                            res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
                            try {
                                const parsedError = JSON.parse(errorBody);
                                res.end(JSON.stringify({ error: parsedError.msg || parsedError.code || `API Error: ${apiRes.statusCode}`, details: parsedError }));
                            } catch (e) {
                                res.end(JSON.stringify({ error: `API Error: ${apiRes.statusCode}`, details: errorBody }));
                            }
                        });
                        return;
                    }

                    // 设置 SSE 响应头
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive'
                    });

                    let buffer = '';
                    let isInDeltaEvent = false;

                    apiRes.on('data', (chunk) => {
                        const text = chunk.toString();
                        buffer += text;
                        
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmedLine = line.trim();
                            
                            if (trimmedLine.startsWith('event:')) {
                                const eventType = trimmedLine.slice(6).trim();
                                isInDeltaEvent = eventType === 'conversation.message.delta';
                                
                                if (eventType === 'done') {
                                    res.write('data: [DONE]\n\n');
                                }
                                continue;
                            }

                            if (trimmedLine.startsWith('data:') && isInDeltaEvent) {
                                try {
                                    const jsonStr = trimmedLine.slice(5).trim();
                                    if (jsonStr) {
                                        const data = JSON.parse(jsonStr);
                                        if (data.content && data.type === 'answer') {
                                            res.write(`data: ${JSON.stringify({ content: data.content })}\n\n`);
                                        }
                                    }
                                } catch (e) {
                                    // Ignore parse errors
                                }
                            }
                        }
                    });

                    apiRes.on('end', () => {
                        res.end();
                    });
                });

                apiReq.on('error', (e) => {
                    console.error(e);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Internal Server Error' }));
                });

                apiReq.write(apiBody);
                apiReq.end();

            } catch (error) {
                console.error(error);
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid Request' }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});


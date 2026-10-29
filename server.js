const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

async function getActiveBotSockets() {
    const activeSockets = [];
    if (!fs.existsSync(sessionsDir)) return activeSockets;
    
    const botFolders = fs.readdirSync(sessionsDir);
    for (const folder of botFolders) {
        const sessionPath = path.join(sessionsDir, folder);
        if (fs.statSync(sessionPath).isDirectory()) {
            try {
                const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
                const sock = makeWASocket({
                    logger: pino({ level: 'silent' }),
                    auth: state,
                    printQRInTerminal: false
                });
                sock.ev.on('creds.update', saveCreds);
                if (sock.user || (sock.ws && sock.ws.isOpen)) {
                    activeSockets.push(sock);
                }
            } catch (err) {
                console.log(`Gagal memuat sesi ${folder}:`, err.message);
            }
        }
    }
    return activeSockets;
}

app.post('/api/react', async (req, res) => {
    const { link, emojis } = req.body;
    try {
        const regex = /whatsapp\.com\/channel\/([^\/]+)\/(\d+)/;
        const match = link.match(regex);
        if (!match) return res.status(400).json({ success: false, message: 'Format link salah!' });

        const channelInviteCode = match[1];
        const messageId = match[2];
        const emojiList = emojis.split(',').map(e => e.trim()).filter(e => e);

        const bots = await getActiveBotSockets();
        if (bots.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada sesi bot aktif di folder sessions!' });
        }

        let totalReacted = 0;
        for (let i = 0; i < bots.length; i++) {
            const bot = bots[i];
            const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];
            try {
                const newsletterMetadata = await bot.newsletterMetadata("invite", channelInviteCode);
                const newsletterJid = newsletterMetadata.id;

                if (typeof bot.newsletterReactMessage === 'function') {
                    await bot.newsletterReactMessage(newsletterJid, messageId, randomEmoji);
                } else {
                    await bot.sendMessage(newsletterJid, {
                        react: { text: randomEmoji, key: { remoteJid: newsletterJid, id: messageId, fromMe: false } }
                    });
                }
                totalReacted++;
                await delay(1200);
            } catch (err) {
                console.error(`Bot ${i+1} gagal:`, err.message);
            }
        }

        if (totalReacted > 0) res.json({ success: true, totalReacted });
        else res.status(500).json({ success: false, message: 'Semua bot gagal mengirim reaksi.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server FINDZ REACT berjalan di http://localhost:${PORT}`);
});

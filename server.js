const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let rooms = {};

function createUnoDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    let deck = [];
    colors.forEach(color => {
        deck.push({ color, value: '0' });
        for (let i = 1; i <= 9; i++) {
            deck.push({ color, value: i.toString() });
            deck.push({ color, value: i.toString() });
        }
        for (let i = 0; i < 2; i++) {
            deck.push({ color, value: 'S' });
            deck.push({ color, value: 'R' });
            deck.push({ color, value: '+2' });
        }
    });
    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'wild', value: 'W' });
        deck.push({ color: 'wild', value: '+4' });
    }
    return shuffleDeck(deck);
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

const avatarColors = ['#ff4d4d', '#4d79ff', '#2ecc71', '#f1c40f', '#9b59b6'];

io.on('connection', (socket) => {
    
    // TELEFONLAR İÇİN ODA LİSTESİNİ ZORLA YENİLEME
    socket.on('getRooms', () => {
        socket.emit('updateRoomList', rooms);
    });

    socket.on('createRoom', (data) => {
        const roomId = "Oda_" + Math.floor(Math.random() * 10000);
        rooms[roomId] = {
            id: roomId, name: data.name, maxPlayers: data.maxPlayers,
            isLocked: data.isLocked, password: data.password,
            hostId: socket.id,
            players: [{ id: socket.id, name: data.hostName, avatarColor: avatarColors[0], hand: [] }],
            deck: [], discardPile: [], isStarted: false
        };
        socket.join(roomId);
        socket.emit('roomJoined', { room: rooms[roomId], isHost: true });
        io.emit('updateRoomList', rooms);
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if (!room) return socket.emit('errorMsg', 'Oda bulunamadı!');
        if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Oda dolu!');
        if (room.isLocked && room.password !== data.password) return socket.emit('errorMsg', 'Yanlış şifre!');
        if (room.isStarted) return socket.emit('errorMsg', 'Oyun zaten başladı!');

        const colorIndex = room.players.length % avatarColors.length;
        room.players.push({ id: socket.id, name: data.playerName, avatarColor: avatarColors[colorIndex], hand: [] });
        socket.join(room.id);
        
        socket.emit('roomJoined', { room: room, isHost: false });
        io.to(room.id).emit('updateWaitingRoom', room);
        io.emit('updateRoomList', rooms);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.hostId === socket.id) {
            
            // TEK KİŞİYLE BAŞLAMA ENGELİ
            if (room.players.length < 2) {
                socket.emit('errorMsg', 'Oyunu başlatmak için en az 2 kişi olmalıdır!');
                return;
            }

            room.isStarted = true;
            room.deck = createUnoDeck();
            room.players.forEach(p => { p.hand = room.deck.splice(0, 7); });

            let topCard = room.deck.pop();
            while(topCard.color === 'wild') {
                room.deck.unshift(topCard); topCard = room.deck.pop();
            }
            topCard.angle = Math.floor(Math.random() * 30) - 15;
            room.discardPile = [topCard];

            io.to(roomId).emit('gameStartedMultiplayer', room);
            io.emit('updateRoomList', rooms);
        }
    });

    socket.on('playCardMultiplayer', (data) => {
        const room = rooms[data.roomId];
        if (room) room.discardPile.push(data.card);
        socket.to(data.roomId).emit('cardPlayed', { card: data.card, remaining: data.remaining });
    });

    socket.on('drawCards', (data) => {
        const room = rooms[data.roomId];
        if (room && room.isStarted) {
            let drawn = [];
            for (let i = 0; i < data.amount; i++) {
                if (room.deck.length === 0 && room.discardPile.length > 1) {
                    const top = room.discardPile.pop();
                    room.deck = shuffleDeck(room.discardPile);
                    room.discardPile = [top];
                }
                if (room.deck.length > 0) drawn.push(room.deck.pop());
            }
            socket.emit('cardsDrawn', drawn);
            socket.to(data.roomId).emit('opponentDrawn', drawn.length);
        }
    });

    socket.on('leaveRoom', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            if (room.isStarted) {
                io.to(roomId).emit('opponentLeft', 'Rakibiniz oyunu terk etti!');
                delete rooms[roomId];
            } else {
                if (room.hostId === socket.id) {
                    io.to(roomId).emit('roomClosed'); delete rooms[roomId];
                } else {
                    room.players = room.players.filter(p => p.id !== socket.id);
                    io.to(roomId).emit('updateWaitingRoom', room);
                }
            }
            socket.leave(roomId);
            io.emit('updateRoomList', rooms);
        }
    });

    socket.on('kickPlayer', (data) => {
        const room = rooms[data.roomId];
        if (room && room.hostId === socket.id) {
            room.players = room.players.filter(p => p.id !== data.playerId);
            const target = io.sockets.sockets.get(data.playerId);
            if(target) target.leave(data.roomId);
            io.to(data.playerId).emit('kicked');
            io.to(data.roomId).emit('updateWaitingRoom', room);
            io.emit('updateRoomList', rooms);
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                if (room.isStarted) {
                    io.to(roomId).emit('opponentLeft', 'Rakibiniz bağlantıyı kopardı veya oyunu terk etti!');
                    delete rooms[roomId];
                } else {
                    if (room.hostId === socket.id) {
                        io.to(roomId).emit('roomClosed'); delete rooms[roomId];
                    } else {
                        room.players.splice(pIdx, 1);
                        io.to(roomId).emit('updateWaitingRoom', room);
                    }
                }
                io.emit('updateRoomList', rooms);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu Başladı! PORT: ${PORT}`);
});

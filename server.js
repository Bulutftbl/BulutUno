const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let rooms = {}; 

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // Yeni oda kurma
    socket.on('createRoom', (data) => {
        const roomId = "Oda_" + Math.floor(Math.random() * 10000);
        rooms[roomId] = {
            id: roomId,
            name: data.name,
            maxPlayers: data.maxPlayers,
            isLocked: data.isLocked,
            password: data.password,
            hostId: socket.id,
            players: [{ id: socket.id, name: data.hostName }]
        };
        socket.join(roomId);
        socket.emit('roomJoined', { room: rooms[roomId], isHost: true });
        io.emit('updateRoomList', rooms); // Diğer herkese listeyi güncelle
    });

    // Odaya katılma (Şifre kontrolü dahil)
    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if (!room) {
            socket.emit('errorMsg', 'Oda bulunamadı!');
            return;
        }
        if (room.players.length >= room.maxPlayers) {
            socket.emit('errorMsg', 'Oda dolu!');
            return;
        }
        if (room.isLocked && room.password !== data.password) {
            socket.emit('errorMsg', 'Yanlış şifre!');
            return;
        }

        room.players.push({ id: socket.id, name: data.playerName });
        socket.join(room.id);
        
        socket.emit('roomJoined', { room: room, isHost: false });
        io.to(room.id).emit('updateWaitingRoom', room); // Odadakilere yeni oyuncuyu göster
        io.emit('updateRoomList', rooms); // Dışarıdaki listeyi güncelle
    });

    // Odadan çıkma veya odayı kapatma
    socket.on('leaveRoom', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            if (room.hostId === socket.id) {
                // Kurucu çıkarsa oda kapanır
                io.to(roomId).emit('roomClosed');
                delete rooms[roomId];
            } else {
                // Sadece oyuncu çıkarsa listeden silinir
                room.players = room.players.filter(p => p.id !== socket.id);
                io.to(roomId).emit('updateWaitingRoom', room);
            }
            socket.leave(roomId);
            io.emit('updateRoomList', rooms);
        }
    });

    // Odadan adam atma (Kick)
    socket.on('kickPlayer', (data) => {
        const room = rooms[data.roomId];
        if (room && room.hostId === socket.id) {
            room.players = room.players.filter(p => p.id !== data.playerId);
            io.sockets.sockets.get(data.playerId).leave(data.roomId);
            io.to(data.playerId).emit('kicked'); // Atılan kişiye mesaj yolla
            io.to(data.roomId).emit('updateWaitingRoom', room);
            io.emit('updateRoomList', rooms);
        }
    });

    // Oyuncu koptuğunda
    socket.on('disconnect', () => {
        // Hangi odadaysa bul ve çıkar
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                if (room.hostId === socket.id) {
                    io.to(roomId).emit('roomClosed');
                    delete rooms[roomId];
                } else {
                    room.players.splice(playerIndex, 1);
                    io.to(roomId).emit('updateWaitingRoom', room);
                }
                io.emit('updateRoomList', rooms);
            }
        }
    });
});

// BULUT SUNUCUSU İÇİN OTOMATİK PORT AYARI
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Sunucu Başladı! PORT: ${PORT}`);
});
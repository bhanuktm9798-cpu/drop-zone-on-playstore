const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const players = new Map();
const rounds = new Map();
const WIDTH = 900;
const HEIGHT = 560;
const TARGET = 3;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.webmanifest') ? 'application/manifest+json' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.json') ? 'application/json' : 'text/html';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const safe = (s, n = 16) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
function send(ws, payload) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
function lobby() {
  return { type: 'lobby', players: [...players.values()].map(p => ({ id: p.id, name: p.name, room: p.room })), rooms: [...rounds.values()].map(r => ({ id:r.id, count:r.players.size, state:r.state })) };
}
function broadcastLobby() { const packet = JSON.stringify(lobby()); for (const p of players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(packet); }
function roomState(room) { return { type:'state', room:room.id, state:room.state, level:room.level, target:TARGET, players:[...room.players].map(id => { const p=players.get(id); return p && { id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,score:p.score,alive:p.alive,color:p.color }; }).filter(Boolean) }; }
function sendRoom(room) { const packet=JSON.stringify(roomState(room)); for (const id of room.players) { const p=players.get(id); if (p && p.ws.readyState===WebSocket.OPEN) p.ws.send(packet); } }
function leave(p) {
  if (!p.room) return;
  const room=rounds.get(p.room); p.room=null;
  if (room) { room.players.delete(p.id); if (room.players.size===0) rounds.delete(room.id); else sendRoom(room); }
  broadcastLobby();
}
function join(p, roomId) {
  leave(p);
  let room=rounds.get(roomId);
  if (!room || room.state==='finished' || room.players.size>=12) { room={id:roomId,players:new Set(),state:'waiting',level:1}; rounds.set(roomId,room); }
  p.room=room.id; p.x=100+Math.random()*(WIDTH-200); p.y=100+Math.random()*(HEIGHT-200); p.hp=100; p.score=0; p.alive=true; p.lastShot=0;
  room.players.add(p.id); sendRoom(room); broadcastLobby();
}
wss.on('connection', ws => {
  const id=Math.random().toString(36).slice(2,10);
  const p={id,ws,name:`Player ${id.slice(0,3).toUpperCase()}`,room:null,x:120,y:120,hp:100,score:0,alive:true,color:`hsl(${Math.floor(Math.random()*360)} 80% 62%)`};
  players.set(id,p); send(ws,{type:'hello',id}); broadcastLobby();
  ws.on('message', raw => {
    let m; try { m=JSON.parse(raw); } catch { return; }
    if (m.type==='name') { p.name=safe(m.name,16)||p.name; broadcastLobby(); if(p.room) sendRoom(rounds.get(p.room)); }
    if (m.type==='join') join(p,safe(m.room,24)||'open-arena');
    if (m.type==='leave') leave(p);
    if (m.type==='move' && p.room && p.alive) {
      const room=rounds.get(p.room); if(!room) return;
      const x=Number(m.x),y=Number(m.y); if(Number.isFinite(x)&&Number.isFinite(y)) { p.x=Math.max(24,Math.min(WIDTH-24,x));p.y=Math.max(24,Math.min(HEIGHT-24,y)); }
      if(m.shoot && Date.now()-p.lastShot>500) {
        p.lastShot=Date.now();
        for(const oid of room.players) { const o=players.get(oid); if(!o||o.id===p.id||!o.alive) continue; if(Math.hypot(o.x-p.x,o.y-p.y)<90) { o.hp-=34; if(o.hp<=0){o.hp=0;o.alive=false;p.score++;} break; } }
      }
      if([...room.players].filter(pid=>players.get(pid)?.alive).length<=1 && room.players.size>1) {
        room.state='finished'; room.level+=1;
        setTimeout(()=>{ if(!rounds.has(room.id)) return; room.state='waiting'; for(const pid of room.players){const q=players.get(pid);if(q){q.hp=100;q.alive=true;q.x=100+Math.random()*(WIDTH-200);q.y=100+Math.random()*(HEIGHT-200);}} sendRoom(room);broadcastLobby(); },5000);
      } else room.state='playing';
      sendRoom(room);
    }
  });
  ws.on('close',()=>{leave(p);players.delete(id);broadcastLobby();});
});
setInterval(()=>{ for(const r of rounds.values()) if(r.state==='playing') sendRoom(r); },100);
server.listen(PORT,'0.0.0.0',()=>console.log(`Drop Zone Online listening on ${PORT}`));

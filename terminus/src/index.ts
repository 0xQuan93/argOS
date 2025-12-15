import blessed from 'blessed';
import WebSocket from 'ws';
import * as readline from 'readline';

// Auth Configuration (Mock)
const PROJECT89_KEYS = ['key-alpha', 'key-omega', 'admin'];

function authenticate(key: string): boolean {
  return PROJECT89_KEYS.includes(key);
}

function startViewer() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Terminus: Project 89 Viewer',
    fullUnicode: true,
  });

  // Layout
  const sidebar = blessed.list({
    top: 0,
    left: 0,
    width: '20%',
    height: '100%',
    items: ['Backroom-1', 'Backroom-2', 'Backroom-3', 'Backroom-4', 'Backroom-5'],
    border: { type: 'line' },
    style: {
      selected: { bg: 'blue', fg: 'white' },
      border: { fg: 'green' },
      fg: 'white'
    },
    label: ' Channels ',
    keys: true,
    mouse: true,
  });

  const mainPanel = blessed.log({
    top: 0,
    left: '20%',
    width: '80%',
    height: '100%',
    border: { type: 'line' },
    style: {
      border: { fg: 'white' },
      fg: 'green'
    },
    label: ' Hallucination Stream ',
    tags: true,
    scrollable: true,
    mouse: true,
  });

  screen.append(sidebar);
  screen.append(mainPanel);
  sidebar.focus();

  // WebSocket Connection
  const ws = new WebSocket('ws://127.0.0.1:3000');
  
  let currentRoomId = 'backroom-1';

  ws.on('open', () => {
    mainPanel.log('{bold}Connected to Project 89 Network.{/bold}');
    mainPanel.log('Authenticating...');
    // We can send auth here if we implemented it on WS level, 
    // but for now we just subscribe.
    
    // Subscribe to default room
    ws.send(JSON.stringify({
        type: 'VIEW_BACKROOM',
        roomId: currentRoomId
    }));
    
    // Also subscribe to receive updates
    ws.send(JSON.stringify({
        type: 'SUBSCRIBE_ROOM',
        roomId: currentRoomId
    }));
  });

  ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'ROOM_UPDATE') {
            const { roomId, data: roomData } = msg.data || msg; // Structure might vary based on server implementation
            
            // Check if it matches current room
            // Note: server sends data wrapped in ROOM_UPDATE
            if (msg.data && msg.data.roomId === currentRoomId) {
                // Log events
                const timestamp = new Date(msg.data.timestamp).toLocaleTimeString();
                
                if (msg.data.type === 'chat' || msg.data.type === 'speech') {
                    mainPanel.log(`{gray-fg}[${timestamp}]{/gray-fg} {bold}${msg.data.agentName || 'Unknown'}:{/bold} ${msg.data.content || msg.data.message}`);
                } else if (msg.data.type === 'stimulus') {
                    // Describe stimulus
                    mainPanel.log(`{gray-fg}[${timestamp}]{/gray-fg} {magenta-fg}* ${msg.data.description || 'Something happened'} *{/magenta-fg}`);
                } else {
                     mainPanel.log(`{gray-fg}[${timestamp}]{/gray-fg} ${JSON.stringify(msg.data)}`);
                }
            }
        } else if (msg.type === 'AGENT_UPDATE') {
             // Maybe show agent status somewhere?
        }
    } catch (e) {
        // mainPanel.log(`Error parsing: ${data}`);
    }
  });

  ws.on('error', (err) => {
    mainPanel.log(`{red-fg}Connection Error: ${err.message}{/red-fg}`);
  });

  ws.on('close', () => {
    mainPanel.log('{red-fg}Disconnected.{/red-fg}');
  });

  // Navigation
  sidebar.on('select', (item, index) => {
    const roomName = item.getText(); // e.g., "Backroom-1"
    const roomId = roomName.toLowerCase(); // "backroom-1"
    
    if (roomId !== currentRoomId) {
        currentRoomId = roomId;
        mainPanel.log(`{bold}Switching to ${roomName}...{/bold}`);
        
        // Unsubscribe old, subscribe new (or server handles switch)
        ws.send(JSON.stringify({
            type: 'SUBSCRIBE_ROOM',
            roomId: currentRoomId
        }));
        
        mainPanel.setContent(''); // Clear log on switch? Or keep history?
        mainPanel.log(`{bold}Viewing ${roomName}{/bold}`);
    }
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    ws.close();
    process.exit(0);
  });

  screen.render();
}

// Entry Point
if (process.argv.includes('--no-auth')) {
    startViewer();
} else {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.clear();
    console.log('\x1b[32m%s\x1b[0m', 'PROJECT 89 TERMINUS INTERFACE v1.0');
    
    rl.question('ENTER AUTH KEY > ', (key) => {
        if (authenticate(key.trim())) {
            console.log('ACCESS GRANTED.');
            setTimeout(() => {
                rl.close();
                startViewer();
            }, 1000);
        } else {
            console.log('ACCESS DENIED.');
            rl.close();
            process.exit(1);
        }
    });
}


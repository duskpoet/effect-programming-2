const connection = new WebSocket(`ws://${location.host}/connect`);
const output = document.querySelector('.output');
connection.addEventListener('message', (event) => {
    appendMessage(event.data, 'incoming');
});

document.querySelector('input').addEventListener('keypress', (event) => {
    if (event.which === 13) {
        connection.send(event.target.value);
        appendMessage(event.target.value, 'outgoing');
        event.target.value = '';
    }
});

function appendMessage(msg, to) {
    const messageNode = document.createElement('div');
    messageNode.className = to;
    messageNode.textContent = msg; 
    output.appendChild(messageNode);
    output.scrollTop = output.scrollHeight;
}
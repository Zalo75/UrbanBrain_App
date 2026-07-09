const message = { 
  message: "¿Podemos poner una cubierta plana con peto y acabado en chapa?", 
  municipio: "oza_cesuras",
  expedienteId: "a07f0f64-1c4b-4732-9378-7d0482124872"
};
fetch('http://localhost:3010/api/chat', { 
  method: 'POST', 
  headers: { 'Content-Type': 'application/json' }, 
  body: JSON.stringify(message) 
})
.then(r => r.json())
.then(data => console.log(JSON.stringify(data, null, 2)))
.catch(console.error);

$(document).ready(function(){
    var socket = io();
  
    socket.on('connect',function(socketio){
      console.log('Connected to Sever');
    });

    // listen to event
    // socket.on('newMessage', function(message){
    //     console.log((message));
    // });

    // catch user ID from browser
    var ID = $('#ID').val();
    socket.emit('ID',{ID:ID});
    
    socket.on('disconnect',function(){
        console.log('Disconnected from Server');
    });

  });
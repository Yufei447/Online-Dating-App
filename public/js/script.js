// send iamge to route '/uploadFile'
$(document).ready(function(){
    // when user clik the upload button, it will automatically give value to the input element
    $('.upload-btn').on('click',function(){
      $('#upload-input').click();
    });
    // send image to s3
    $('#upload-input').on('change',function(){
      var uploadInput = $('#upload-input');
      if (uploadInput.val() !=''){
        // get the image
        var formData = new FormData();
        formData.append('upload',uploadInput[0].files[0]);
        // console.log(formData)

        // send iamge to route '/uploadFile'
        $.ajax({
          url: '/uploadFile',
          type: 'POST',
          data: formData,
          processData: false,
          contentType: false,
          success: function(){
              uploadInput.val('');
          }
        });
      }
    });
});
// Make chatRoom autoscroll
$(document).ready(function(){
  $('#messages').animate({scrollTop:100000},800);
});
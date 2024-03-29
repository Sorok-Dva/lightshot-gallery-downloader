$('h1.page-header__title').append(' - <span id="download">Download my gallery</span>');
$('#download').css('cursor', 'pointer');

$('#download').click(function () {
  $(this).unbind('click');
  initLogger();
  init();
});

var init = function () {
  $.jsonRPC.request("get_user_screens", {
    params: {start_id36: 0, count: 5000}, success: function (response) {
      if (response.result.success) {
        logger('Retrieving ' + response.result.screens.length + ' screenshots');
        var zip = new JSZip();
        $.each(response.result.screens, function (i, data) {
          JSZipUtils.getBinaryContent(data.url, function (err, r) {
            if (err) throw err;
            logger('Getting screenshot id ' + data.id36 + ' (screenshot number ' + (i + 1) + ')');
            zip.file('screenshot_' + data.id36 + '.png', r, {binary: true});
          });
          if (i + 1 === response.result.screens.length) {
            logger('Your download should be ready in ' + (i / 60).toFixed(2) + ' seconds');
            setTimeout(function () {
              logger('Compilation of screenshots in progress');
              logger('Your download is starting');
              zip.generateAsync({type: "blob"})
                .then(function (content) {
                  saveAs(content, 'lightshotGallery.zip');
                });
            }, i * 1000 / 60)
          }
        });
      } else
        throw 'Failed';
    }
  })
};

var initLogger = function () {
  $('.uploader-envelope').append('<div class="extLogger">');
  $('.extLogger').css({
    width: '100%',
    height: '350px',
    border: '1px solid red',
    padding: '10px',
    'overflow-y': 'auto',
  })
};

var logger = function (message) {
  $('.extLogger').append(message + '<br>').animate({scrollTop: $('.extLogger').prop("scrollHeight")}, 0);
};

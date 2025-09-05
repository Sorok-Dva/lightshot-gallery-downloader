$('h1.page-header__title').append(' - <span id="download">Download my gallery</span>');
$('#download').css('cursor', 'pointer');

$('#download').click(function () {
  $(this).unbind('click');
  initLogger();
  init();
});

var init = function () {
  $.jsonRPC.request("get_user_screens", {
    params: { start_id36: 0, count: 5000 },
    success: async function (response) {
      if (response.result.success) {
        logger('Retrieving ' + response.result.screens.length + ' screenshots');
        var zip = new JSZip();

        // Convert each download into a Promise
        const downloadPromises = response.result.screens.map((data, i) => {
          return new Promise((resolve) => {
            JSZipUtils.getBinaryContent(data.url, function (err, r) {
              if (err) {
                logger('Failed to download screenshot ' + data.id36);
                resolve(); // Skip failed downloads instead of crashing
              } else {
                logger('Downloaded screenshot id ' + data.id36 + ' (' + (i + 1) + '/' + response.result.screens.length + ')');
                zip.file('screenshot_' + data.id36 + '.png', r, { binary: true });
                resolve();
              }
            });
          });
        });

        // Wait for ALL downloads to finish
        await Promise.all(downloadPromises);

        logger('All screenshots downloaded. Generating ZIP...');
        zip.generateAsync({ type: "blob" })
          .then(function (content) {
            saveAs(content, 'lightshotGallery.zip');
            logger('ZIP download started!');
          });
      } else {
        throw 'Failed to fetch screenshots';
      }
    }
  });
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

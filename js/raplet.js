$('.email').click(function() {
  alert($(this).attr('data-subject') + ':' + $(this).attr('data-body'));
});

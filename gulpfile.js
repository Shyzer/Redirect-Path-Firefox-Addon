var gulp = require('gulp');
var watch = require('gulp-watch');
var sass = require('gulp-sass');
var batch = require('gulp-batch');

gulp.task('watch', function ()
{
    gulp.start('styles');

    watch('src/sass/**/*.scss', batch(function (events, cb)
    {
        gulp.start('styles', cb);
    }));
});

gulp.task('styles', function ()
{
    return gulp
        .src('src/sass/**/*.scss')
        .pipe(sass({errLogToConsole: true}))
        .pipe(gulp.dest('assets/css'))
});
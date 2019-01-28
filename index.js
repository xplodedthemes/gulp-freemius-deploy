/**
 * Deploy to Freemius.
 *
 * The `args` param should contain values for developer_id, plugin_id, access_token, zip_name, zip_name_free, add_contributor, auto_release.
 *
 * @param gulp
 * @param args
 */
module.exports = function( gulp, dirname, args ) {

    /**
     * Deps.
     */

    var notifier = require( 'node-notifier' ),
        os = require('os'),
        fs = require( 'fs' ),
        path = require('path'),
        extract = require('extract-zip'),
        replace = require('gulp-replace'),
        zip = require('gulp-zip'),
        clean = require('gulp-clean'),
        needle = require( 'needle' ),
        request = require( 'request' ),
        httpBuildQuery = require('http-build-query'),
        cryptojs = require( 'crypto-js' ),
        exec = require("sync-exec");


    const FS_API_ENPOINT = 'https://api.freemius.com';
    const AUTH = 'FSA ' + args.developer_id + ':' + args.access_token;

    const SRC_PATH = path.resolve(dirname, 'src');
    const DIST_PATH = path.resolve(dirname, 'dist');


    /**
     * Base 64 URL encode.
     *
     * @param str
     * @return string
     */
    var base64_url_encode = function( str ) {
        str = new Buffer( str ).toString( 'base64' );
        // str = strtr(base64_encode($input), '+/', '-_');
        str = str.replace( /=/g, '' );

        return str;
    };


    var runExec = function(command) {

        console.log(command);

        let response = exec(command);
        if(response.stderr) throw response.stderr;

        console.log(response.stdout);
    };


    gulp.task('npm-update', function (done) {

        runExec('npm update');

        done();
    });

    gulp.task('clean', function (done) {
        if(fs.existsSync('src') || fs.existsSync('dist')) {
            return gulp.src(['src', 'dist'], {read: false})
                .pipe(clean());
        }
        done();
    });

    gulp.task('structure', (done) => {

        const folders = [
            'src',
            'dist'
        ];

        folders.forEach(dir => {
            if(!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
                console.log('Folder created:', dir);
            }
        });

        done();
    });

    gulp.task('prepare', () =>
        gulp.src([
            '../**',
            '!../node_modules/**',
            '!../gulpfile*',
            '!**'
        ])
            .pipe(zip('deploy.zip'))
            .pipe(gulp.dest('src'))
    );

    gulp.task( 'freemius-deploy', (done) => {

        if (!Number.isInteger(args.plugin_id)) {
            return;
        }

        var res_url = function (path, params = null) {

            if (params) {
                params = '?' + params;
            }

            return FS_API_ENPOINT + '/v1/developers/' + args.developer_id + '/plugins/' + args.plugin_id + '/' + path + params;
        }

        var buffer = fs.readFileSync(SRC_PATH + '/deploy.zip'),
            data = {
                add_contributor: args.add_contributor,
                file: {
                    buffer: buffer,
                    filename: 'deploy.zip',
                    content_type: 'application/zip'
                }
            },
            options = {
                multipart: true,
                headers: {
                    "Authorization": AUTH
                }
            };


        // Deploy to Freemius

        needle('post', res_url('tags.json'), data, options).then(function (response) {

            var body = response.body;
            var message;
            var tag_id;

            if (typeof body !== 'object') {
                message = 'Something Went Wrong! ';
                notifier.notify({message: message});
                console.log('\x1b[31m%s\x1b[0m', message);
                
                done();
                return;
            }

            if (typeof body.error !== 'undefined') {
                message = 'Error: ' + body.error.message;
                notifier.notify({message: message});
                console.log('\x1b[31m%s\x1b[0m', message);

                done();
                return;
            }

            tag_id = body.id;

            message = 'Successfully deployed v' + body.version + ' to Freemius.';
            notifier.notify({message: message});
            console.log('\x1b[32m%s\x1b[0m', message);

			// Set plugin version at gulp level
			gulp.plugin_version = body.version;
			

            // Auto Release Version
            if(args.auto_release) {

                var data = {
                        is_released: true
                    },
                    options = {
                        headers: {
                            "Authorization": AUTH
                        }
                    };

                needle('put', res_url('tags/' + tag_id + '.json', 'fields=id,is_released,version'), data, options).then(function (response) {

                    var body = response.body;

                    if (typeof body !== 'object') {
                        message = 'Something Went Wrong! ';
                        notifier.notify({message: message});
                        console.log('\x1b[31m%s\x1b[0m', message);
                        done();
                        return;
                    }

                    if (typeof body.error !== 'undefined' || !body.is_released) {
                        message = 'Error: ' + body.error.message;
                        notifier.notify({message: message});
                        console.log('\x1b[31m%s\x1b[0m', message);
                        done();
                        return;
                    }

                    message = 'Successfully released v' + body.version + ' on Freemius';
                    notifier.notify({message: message});
                    console.log('\x1b[32m%s\x1b[0m', message);
                })
                .catch(function (error) {
                    message = 'Error releasing version on Freemius.';
                    notifier.notify({message: message});
                    console.log('\x1b[31m%s\x1b[0m', message);
                    console.log(error);

                    done();
                    return;
                });

            }


            // Download Premium Version

            var download_url = res_url('tags/' + tag_id + '.zip', httpBuildQuery({
                authorization: AUTH,
                beautify: true,
                is_premium: true,
            }));

            request(download_url)
                .pipe(fs.createWriteStream(DIST_PATH + '/' + args.zip_name))
                .on('error', (error) => {
                    console.log('\x1b[31m%s\x1b[0m', error);

                    done();
                    return;
                })
                .on('close', function () {
                    message = "The premium version was downloaded to " + DIST_PATH + '/' + args.zip_name;
                    notifier.notify({message: message});
                    console.log('\x1b[32m%s\x1b[0m', message);


                    // Download Free Version

                    var download_url = res_url('tags/' + tag_id + '.zip', httpBuildQuery({
                        authorization: AUTH,
                        beautify: true,
                        is_premium: false,
                    }));

                    request(download_url)
                        .pipe(fs.createWriteStream(DIST_PATH + '/' + args.zip_name_free))
                        .on('error', (error) => {
                            console.log('\x1b[31m%s\x1b[0m', error);

                            done();
                            return;
                        })
                        .on('close', function () {
                            message = "The free version was downloaded to " + DIST_PATH + '/' + args.zip_name_free;
                            notifier.notify({message: message});
                            console.log('\x1b[32m%s\x1b[0m', message);

                            done();
                            return;
                        });

                });

        })
        .catch(function (error) {
            message = 'Error deploying to Freemius.';
            notifier.notify({message: message});
            console.log('\x1b[31m%s\x1b[0m', message);
            console.log(error);

            done();
            return;
        });

    });


    gulp.task('wordpress-deploy', function (cb) {

        if(args.svn_path === false) {
            cb();
            return;
        }

        let svn_path = os.homedir() + args.svn_path + '/';
        let svn_trunk_path = svn_path + 'trunk/';
        let zip_path = DIST_PATH + '/';
        let extracted_path = zip_path + 'free/';

        console.log('svn_path', svn_path);
        console.log('svn_trunk_path', svn_trunk_path);

        extract(zip_path + args.zip_name_free, {dir: extracted_path}, function (err) {
            // extraction is complete. make sure to handle the err

            if(err) throw err;

            runExec('cd '+svn_trunk_path+' && rm -rf *');
            runExec('cd '+extracted_path+'*/ && cp -R ./* '+svn_trunk_path);
            runExec('cd '+svn_path+' && svn upgrade');
            runExec('cd '+svn_path+' && svn status | grep \'^!\' | awk \'{print $2}\' | xargs svn delete');
            runExec('cd '+svn_path+' && svn add --force .');
            runExec('cd '+svn_path+' && svn commit -m "Update"');

            cb();

        });

    });

    gulp.task('envato-deploy', function (cb) {

        let zip_path = DIST_PATH + '/';
        let extracted_path = zip_path + 'envato/';

        extract(zip_path + args.zip_name, {dir: extracted_path}, function (err) {
            // extraction is complete. make sure to handle the err

            if(err) throw err;

            gulp.src(extracted_path+'*/*.php')
                .pipe(replace('##XT_MARKET##', 'envato'))
                .pipe(gulp.dest(extracted_path))


            gulp.src(extracted_path+'*/**')
                .pipe(zip(args.zip_name))
                .pipe(gulp.dest(extracted_path))

            gulp.src([extracted_path+'*/**'], {read: false})
                .pipe(clean());

            cb();

        });

    });

    gulp.task('git-deploy', function (cb) {

        if(!gulp.plugin_version) {
            return cb();
        }

        runExec('cd .. && git add .');
        runExec('cd .. && git commit -a -m "Update"');
        runExec('cd .. && git pull origin');
        runExec('cd .. && git submodule update --recursive --remote');
        runExec('cd .. && git tag -f '+gulp.plugin_version);
        runExec('cd .. && git push -f --tags');
        cb();
    });

    
    gulp.task('deploy', gulp.series(
        'npm-update',
        'clean',
        'structure',
        'prepare',
        'freemius-deploy',
        'wordpress-deploy',
        'envato-deploy',
        'git-deploy'
    ));

};

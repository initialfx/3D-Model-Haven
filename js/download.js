const downloadViaSW = false;
let downloadStatus = { activeCount: 0 };

if (downloadViaSW) {
    document.addEventListener("DOMContentLoaded", async () => {
        try {
            // prepare service worker
            const swreg = await navigator.serviceWorker.register('/download-sw.js', { scope: '/__download__/' });
            await swreg.update();
            // keep alive ping (required for firefox)
            setInterval(() => {
                try {
                    if (swreg.active) {
                        swreg.active.postMessage({ command: 'ping' });
                    }
                }
                catch (error) {
                    console.error(error);
                }
            }, 1000);
            // status update handler
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data.command == 'update-status') {
                    downloadStatus = event.data.status;
                    console.log('downloadStatus=', JSON.stringify(downloadStatus));
                }
            });
            let activeWorker = null;
            setInterval(() => {
                try {
                    if (swreg.active && activeWorker !== swreg.active) {
                        activeWorker = swreg.active;
                        activeWorker.postMessage({ command: 'broadcast-status' });
                    }
                }
                catch (error) {
                    console.error(error);
                }
            }, 1000);
        }
        catch (error) {
            console.error(error);
        }
    });
}

if (navigator.userAgent.indexOf("Firefox") > -1) {
    window.addEventListener('beforeunload', function (event) {
        if (downloadStatus && downloadStatus.activeCount > 0) {
            event.preventDefault();
            event.returnValue = '';
            return false;
        }
    });
}

async function createDownload(name, files) {
    if (downloadViaSW) {
        // prepare service worker
        const swreg = await navigator.serviceWorker.register('/download-sw.js', { scope: '/__download__/' });
        while (!swreg.active) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log('service worker ready');
        // prepare virtual URL
        const url = window.location.origin
            + '/__download__/'
            + new Date().toISOString().slice(0, 19).replace(/[T\-:]/gi, '') + '/'
            + name
            + '.zip';
        console.log('creating download ' + url);
        console.log(JSON.stringify(files, null, 2));
        // configure URL in service worker
        return await new Promise(function (resolve, reject) {
            const channel = new MessageChannel();
            channel.port1.addEventListener('message', (event) => {
                if (event.data.result) {
                    return resolve(url);
                }
                return reject(new Error('could not prepare download' + (event.data.message ? `: ${event.data.message}` : '')));
            });
            channel.port1.start();
            if (!swreg.active) {
                return reject(new Error('could not find active service worker'));
            }
            swreg.active.postMessage(
                {
                    command: 'create',
                    data: { url, files },
                },
                [channel.port2]
            );
        });
    }
    else {
        // generating zip file
        const zip = new Zip(false);
        downloadStatus.activeCount += 1;
        try {
            // download files
            for (const file of files) {
                console.log('downloading ' + file.url + '...');
                zip.startFile(file.path);
                const reader = (await fetch(file.url)).body.getReader();
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done) {
                        break;
                    }
                    zip.appendData(chunk.value);
                }
                zip.endFile();
            }
            // finalize zip file
            zip.finish();
            console.log('completed successfully');
        } catch (error) {
            console.error(error);
            zip.error(error);
        }
        downloadStatus.activeCount -= 1;
        // propagate errors
        if (zip.outputError) {
            throw zip.outputError;
        }
        // create blob url
        return URL.createObjectURL(new Blob(zip.outputBytes, { type: 'application/zip' }));
    }
}

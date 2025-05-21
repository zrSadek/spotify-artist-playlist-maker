console.clear();

const { clientID, redirectURI, secretID } = require('./settings.json');

if (!clientID || !redirectURI || !secretID) {
    console.error('Please set your Spotify API credentials in settings.json.');
    console.error('You can get them from https://developer.spotify.com/dashboard/applications');
    console.error('Make sure to set the redirect URI to http://127.0.0.1:8000/callback');
    process.exit(1);
}

const readline = require('readline');
const express = require('express');
const querystring = require('querystring');
const SCOPES = 'playlist-modify-public';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
}

async function getAuthToken() {
    const app = express();

    return new Promise((resolve, r) => {
        const state = Math.random().toString(36).substring(7);
        const authUrl = 'https://accounts.spotify.com/authorize?' +
            querystring.stringify({
                response_type: 'code',
                client_id: clientID,
                scope: SCOPES,
                redirect_uri: redirectURI,
                state: state
            });

        console.log('🔧 Open the following link on your browser: \n->', authUrl);

        const server = app.listen(8000);

        app.get('/callback', async (req, res) => {
            const code = req.query.code;

            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'post',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${clientID}:${secretID}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: querystring.stringify({
                    code,
                    redirect_uri: redirectURI,
                    grant_type: 'authorization_code'
                })
            });

            const data = await response.json();

            res.send('200');
            server.close();

            resolve(data.access_token);
            console.clear();
        });
    });
}

async function createPlaylistForArtist(inputName, token, userId) {
    const search = await fetchJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(inputName)}&type=artist&limit=5`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const artists = search.artists.items;

    if (artists.length === 0) {
        console.log('Artist not found.');
        return;
    }

    console.log(`Found ${artists.length} artists:`);
    artists.forEach((artist, i) => {
        console.log(`${i + 1}. ${artist.name} (${artist.followers.total.toLocaleString()} followers)`);
    });

    let choice = await ask(`Choose a number between 1 and ${artists.length} to select the artist (0 to cancel) : `);
    let index = parseInt(choice) - 1;

    if (isNaN(index) || index < 0 || index >= artists.length)
        return console.clear();

    const artist = artists[index];
    const artistId = artist.id;
    console.log(`You selected "${artist.name}"`);

    const albumsRes = await fetchJson(`https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single&limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const albumIds = [...new Set(albumsRes.items.map(a => a.id))];

    let tracks = [];
    for (const albumId of albumIds) {
        const res = await fetchJson(`https://api.spotify.com/v1/albums/${albumId}/tracks`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        res.items.forEach(t => {
            tracks.push({ name: t.name, uri: t.uri });
        });
    }

    const seen = new Set();
    const sortedTracks = tracks
        .filter(t => {
            if (seen.has(t.name)) return false;
            seen.add(t.name);
            return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    console.log(`${sortedTracks.length} tracks found (only tracks in his/her albums).`);

    const playlistRes = await fetch('https://api.spotify.com/v1/users/' + userId + '/playlists', {
        method: 'post',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: `${artist.name}`,
            public: true,
            description: null
        })
    });

    const playlistData = await playlistRes.json();
    const playlistId = playlistData.id;

    const uris = sortedTracks.map(t => t.uri);
    for (let i = 0; i < uris.length; i += 100) {
        await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            method: 'post',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: uris.slice(i, i + 100) })
        });
    }

    console.log(`Playlist with (i hope) every ${artist.name} tracks has been created\n      - ${playlistData.external_urls.spotify}` );
}

async function main() {
    const token = await getAuthToken();

    const me = await fetchJson('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` }
    });

    const userId = me.id;

    while (true) {
        console.log('\n-----------------------------------\n');
        const artistName = await ask('The artist name you looking for (type "exit" to exit the process) : ');
        if (artistName.trim().toLowerCase() === 'exit')
            break;

        try {
            await createPlaylistForArtist(artistName, token, userId);
        } catch (err) {
            console.error(err);
        }
    }

    rl.close();
}

main().catch(console.error);

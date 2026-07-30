#!/usr/bin/env python3
# Dev server pro Water Shoot.
# POZOR: port 8090 — 8080 patří ballon-belt, nekřížit! (viz CLAUDE.md)
#
# Run: python3 server.py
# Browse: http://localhost:8090/gamee/index_local.html
# Worktree LIVE: http://localhost:8090/.claude/worktrees/<větev>/gamee/index_local.html
#   (docroot = adresář tohoto souboru; při běhu z main repa servíruje i worktrees)

import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8090
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    print('Water Shoot dev server -> http://localhost:%d/' % PORT)
    print('  game: http://localhost:%d/gamee/index_local.html' % PORT)
    print('  root: ' + REPO_ROOT)
    HTTPServer(('', PORT), NoCacheHandler).serve_forever()

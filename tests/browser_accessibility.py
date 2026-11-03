"""Optional local browser smoke test (Python Playwright + installed Chromium).

Run: python tests/browser_accessibility.py
No production credentials, network calls, account creation or GitHub Actions required.
"""
import os
import re
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    port = free_port()
    with tempfile.TemporaryDirectory(prefix='cedar-browser-') as folder:
        env = os.environ.copy()
        for key in ('CEDAR_USERS_JSON','CEDAR_ADMIN_PASSWORD','CEDAR_REVIEWER_PASSWORD','CEDAR_VIEWER_PASSWORD','NODE_ENV','CEDAR_IDENTITY_MODE'):
            env.pop(key, None)
        env.update({'PORT':str(port),'HOST':'127.0.0.1','DB_PATH':str(Path(folder)/'cedar.sqlite')})
        command = [os.environ.get('CEDAR_NODE', 'node'), '--disable-warning=ExperimentalWarning', '--experimental-sqlite', '--experimental-strip-types', str(ROOT/'src/server.ts')]
        server = subprocess.Popen(command, cwd=folder, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(70):
                if server.poll() is not None:
                    raise AssertionError('Cedar server exited unexpectedly')
                try:
                    if urlopen(f'http://127.0.0.1:{port}/api/auth/status', timeout=.3).status == 200:
                        break
                except Exception:
                    time.sleep(.08)
            else:
                raise AssertionError('Cedar server not ready')
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CEDAR_CHROMIUM','/usr/bin/chromium'), args=['--no-sandbox'])
                for width, height in ((1280, 900), (390, 844)):
                    page = browser.new_page(viewport={'width':width, 'height':height}, reduced_motion='reduce')
                    errors=[]
                    page.on('pageerror',lambda e: errors.append(str(e)))
                    page.goto(f'http://127.0.0.1:{port}/', wait_until='domcontentloaded')
                    page.get_by_role('heading', name='Portfolio overview').wait_for(timeout=8000)
                    assert page.locator('.skip-link').count()==1
                    nav = page.locator('[data-nav="imports"]')
                    nav.focus()
                    assert nav.evaluate('(el)=>el===document.activeElement'), 'navigation must be keyboard focusable'
                    assert nav.evaluate('(el)=>getComputedStyle(el).outlineStyle')!='none', 'keyboard focus outline must be visible'
                    page.keyboard.press('Enter')
                    page.get_by_role('heading',name='Program data imports').wait_for()
                    assert nav.get_attribute('aria-current')=='page', 'active navigation should be announced'
                    assert page.get_by_role('heading',name='Program data imports').evaluate('(el)=>el===document.activeElement'), 'page title must receive focus'
                    page.get_by_role('button',name='Stage partial fixture').click()
                    page.get_by_text('Publication blocked:').wait_for()
                    assert page.get_by_role('button',name='Publish verified snapshot').is_disabled(), 'partial import must be blocked'
                    page.locator('[data-back="imports"]').click()
                    page.get_by_role('button',name='Stage late outcome').click()
                    page.get_by_role('heading',name='Publish this import').wait_for()
                    assert page.locator('#quarantine-reason').count()==1
                    publish=page.get_by_role('button',name='Publish verified snapshot')
                    publish.click()
                    page.get_by_text(re.compile('Accept the quarantine and enter a review decision')).wait_for()
                    assert page.locator('#commit-error').evaluate('(el)=>document.activeElement===el'), 'error should receive keyboard focus'
                    page.locator('#quarantine-consent').check()
                    page.locator('#quarantine-reason').fill('Reviewed duplicate rows and unmapped code; source correction will be requested.')
                    publish.click()
                    page.get_by_role('heading',name='Portfolio overview').wait_for()
                    assert page.locator('[data-nav="overview"]').get_attribute('aria-current')=='page'
                    assert not errors, f'JavaScript errors in viewport {width}: {errors}'
                    # Table regions may scroll horizontally on mobile; no page-level overflow.
                    overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
                    assert overflow<=12, f'Unexpected page overflow {overflow}px at width {width}'
                    print(f'PASS: {width}px keyboard navigation, partial import, admin review, publish, responsive layout')
                    page.close()
                browser.close()
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill();server.wait(timeout=5)


if __name__=='__main__':
    main()

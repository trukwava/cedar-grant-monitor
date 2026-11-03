import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
const file=(name:string)=>readFileSync(path.join(project,name),'utf8');

test('accessible navigation and import review indicators remain in the UI',()=>{
 const html=file('public/index.html'),code=file('public/app.js'),css=file('public/styles.css');
 assert.match(html,/class="skip-link"/);
 assert.match(html,/<main id="main" tabindex="-1" aria-live="polite"/);
 assert.match(html,/id="toast"[^>]+role="status"/);
 assert.match(code,/aria-current','page'/);
 assert.match(code,/function focusPageHeading\(\)/);
 assert.match(code,/id="commit-error" role="alert" aria-live="assertive" tabindex="-1"/);
 assert.match(code,/id="quarantine-reason"/);
 assert.match(code,/getField\('quarantine-reason'\)/);
 assert.match(css,/:focus-visible/);
 assert.match(css, /prefers-reduced-motion:reduce/);
});

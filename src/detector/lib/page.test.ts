import { describe, expect, it } from 'vitest';
import { classifyPage } from './page';

describe('classifyPage: which kind of page the panel is looking at', () => {
  it('knows the Google unusual-traffic page, where YouTube asks if you are a person', () => {
    expect(classifyPage('https://www.google.com/sorry/index?continue=https://www.youtube.com/watch%3Fv%3Dabc&q=x')).toEqual({ kind: 'check' });
    expect(classifyPage('https://www.google.com/search?q=skipz')).toEqual({ kind: 'other', host: 'google.com' });
  });
  it('reads YouTube channel pages in every address style', () => {
    expect(classifyPage('https://www.youtube.com/@noracodes')).toEqual({ kind: 'channel', handle: '@noracodes' });
    expect(classifyPage('https://www.youtube.com/@noracodes/videos')).toEqual({ kind: 'channel', handle: '@noracodes' });
    expect(classifyPage('https://m.youtube.com/@NoraCodes/shorts')).toEqual({ kind: 'channel', handle: '@NoraCodes' });
    expect(classifyPage('https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA')).toEqual({ kind: 'channel', channelId: 'UCsBjURrPoezykLs9EqgamOA' });
    expect(classifyPage('https://www.youtube.com/c/Fireship')).toEqual({ kind: 'channel', legacy: 'c/Fireship' });
    expect(classifyPage('https://www.youtube.com/user/marquesbrownlee')).toEqual({ kind: 'channel', legacy: 'user/marquesbrownlee' });
  });

  it('reads video pages: watch, short links and Shorts', () => {
    expect(classifyPage('https://www.youtube.com/watch?v=FluKUJyeYD8&t=42s')).toEqual({ kind: 'video', videoId: 'FluKUJyeYD8' });
    expect(classifyPage('https://youtu.be/ORp9KJCElvg?si=abc')).toEqual({ kind: 'video', videoId: 'ORp9KJCElvg' });
    expect(classifyPage('https://www.youtube.com/shorts/r-tzcMIQISk')).toEqual({ kind: 'video', videoId: 'r-tzcMIQISk', short: true });
  });

  it('treats YouTube pages full of videos as a list', () => {
    expect(classifyPage('https://www.youtube.com/results?search_query=study+setup')).toEqual({ kind: 'videoList', query: 'study setup' });
    expect(classifyPage('https://www.youtube.com/')).toEqual({ kind: 'videoList' });
    expect(classifyPage('https://www.youtube.com/feed/subscriptions')).toEqual({ kind: 'videoList' });
    expect(classifyPage('https://www.youtube.com/playlist?list=PL123')).toEqual({ kind: 'videoList' });
  });

  it('recognises Gmail', () => {
    expect(classifyPage('https://mail.google.com/mail/u/0/#inbox/FMfcgz')).toEqual({ kind: 'gmail' });
  });

  it('calls every other web page "other", and pages Skipz cannot read "none"', () => {
    expect(classifyPage('https://www.notion.com/')).toEqual({ kind: 'other', host: 'notion.com' });
    expect(classifyPage('chrome://extensions')).toEqual({ kind: 'none' });
    expect(classifyPage('https://chromewebstore.google.com/detail/x')).toEqual({ kind: 'none' });
    expect(classifyPage('')).toEqual({ kind: 'none' });
    expect(classifyPage(undefined)).toEqual({ kind: 'none' });
  });
});

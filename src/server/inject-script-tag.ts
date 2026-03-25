export function injectScriptTag(html: string): string {
  const tag = '<script src="/setting-searchbar/client.js"></script>';
  const headClose = html.indexOf('</head>');
  if (headClose !== -1) {
    return html.slice(0, headClose) + tag + html.slice(headClose);
  }
  return html + tag;
}

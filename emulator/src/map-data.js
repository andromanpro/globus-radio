import { loadGzipJson } from './geo';

const requests = new Map();

export function loadMapData(dataUrl, name) {
  const url = `${dataUrl}${name}`;
  if (!requests.has(url)) {
    requests.set(url, loadGzipJson(url).catch(error => {
      requests.delete(url);
      throw error;
    }));
  }
  return requests.get(url);
}

export const formatColorDisplay = (color: string | undefined): string => {
  if (!color) return '';
  
  // Check if it looks like an object that was stringified
  if (color === '[object Object]' || color.includes('[object Object]')) {
    return 'RGB color';
  }
  
  // Check if it's already in RGB format
  if (color.startsWith('rgb(')) {
    return color;
  }
  
  // Try to parse it if it looks like a JSON string
  if (color.startsWith('{') && color.endsWith('}')) {
    try {
      const parsed = JSON.parse(color);
      if (parsed.r !== undefined && parsed.g !== undefined && parsed.b !== undefined) {
        return `rgb(${parsed.r},${parsed.g},${parsed.b})`;
      }
    } catch (e) {
      // Parsing failed, continue
    }
  }
  
  return color;
};

export const getSocketUrl = (): string => {
  if (process.env.NODE_ENV === 'development') {
    // Local development - connect directly to backend
    return 'http://localhost:3001';
  } else {
    // Production - use current protocol and hostname, proxy through nginx
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.host}`;
  }
};

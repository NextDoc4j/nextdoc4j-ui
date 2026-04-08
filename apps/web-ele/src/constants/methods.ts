export const methodType: Record<string, any> = {
  GET: {
    backgroundColor: '#e3f6ed',
    color: '#17b26a',
  },
  PUT: {
    backgroundColor: '#60a5fa33',
    color: '#1d4ed8',
  },
  POST: {
    backgroundColor: '#fdede4',
    color: '#ef6820',
  },
  DELETE: {
    backgroundColor: '#fde9e7',
    color: '#f04438',
  },
  PATCH: {
    backgroundColor: '#fde9f7',
    color: '#ee46bc',
  },
};

const darkMethodType: Record<string, any> = {
  PUT: {
    backgroundColor: 'rgba(37, 99, 235, 0.3)',
    border: '1px solid rgba(96, 165, 250, 0.42)',
    boxShadow: 'inset 0 0 0 1px rgba(147, 197, 253, 0.06)',
    color: '#60a5fa',
  },
};

export const getMethodStyle = (method?: string, isDark = false) => {
  const normalizedMethod = method?.toUpperCase?.() || 'GET';
  const baseStyle = methodType[normalizedMethod] || methodType.GET;

  if (!isDark) {
    return baseStyle;
  }

  return {
    ...baseStyle,
    ...darkMethodType[normalizedMethod],
  };
};

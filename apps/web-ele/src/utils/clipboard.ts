export async function copyText(value: string) {
  const text = `${value ?? ''}`;
  if (!text) {
    return false;
  }

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function' &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below for non-secure or blocked contexts.
    }
  }

  if (typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  const selection = document.getSelection();
  const ranges =
    selection && selection.rangeCount > 0
      ? Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index).cloneRange(),
        )
      : [];
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();

  if (selection) {
    selection.removeAllRanges();
    ranges.forEach((range) => selection.addRange(range));
  }
  activeElement?.focus?.();

  return copied;
}

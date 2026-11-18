import { Injectable } from '@angular/core';

export interface ShareableFile {
  name: string;
  mimeType: string;
  content: string | Blob;
}

/**
 * Sharing, downloading and image/calendar helpers that touch the DOM or
 * browser File/Share APIs. Kept separate from BackupService so that
 * service stays pure data logic.
 */
@Injectable({ providedIn: 'root' })
export class FilesService {
  /**
   * Shares a file via the Web Share API (so iOS offers "Save to Files" /
   * AirDrop), falling back to a plain download link. Returns true only if
   * the file actually left the app (shared or downloaded) — if the user
   * cancels the share sheet, this resolves false so callers can avoid
   * recording a successful backup.
   */
  async shareOrDownload(file: ShareableFile): Promise<boolean> {
    const blob = file.content instanceof Blob ? file.content : new Blob([file.content], { type: file.mimeType });
    const domFile = new File([blob], file.name, { type: file.mimeType });

    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
      share?: (data: { files?: File[] }) => Promise<void>;
    };

    if (nav.canShare && nav.share && nav.canShare({ files: [domFile] })) {
      try {
        await nav.share({ files: [domFile] });
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return false; // user cancelled the share sheet
        }
        // Sharing failed for some other reason: fall through to download.
      }
    }

    this.downloadBlob(blob, file.name);
    return true;
  }

  downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Resizes an image (File, Blob or data URL) to fit within `maxSize`, as a JPEG data URL. */
  async resizeImageToDataUrl(source: Blob | string, maxSize = 640, quality = 0.85): Promise<string> {
    const bitmap = await this.loadImage(source);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is not available.');
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  private loadImage(source: Blob | string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
      const img = new Image();
      img.onload = () => {
        // Safe to revoke now: onload fires once the bitmap is decoded, and
        // nothing downstream (drawing it to a canvas) needs the URL alive.
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not load the image.'));
      };
      img.src = objectUrl ?? (source as string);
    });
  }

  /** Builds a daily-repeating .ics calendar event text, with an alarm at the event time. */
  buildDailyReminderIcs(hour: number, minute: number, title = 'Recallo — review your cards'): string {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
    if (start.getTime() < now.getTime()) {
      start.setDate(start.getDate() + 1);
    }
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const toIcsDate = (d: Date): string =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Recallo//Flashcards//EN',
      'BEGIN:VEVENT',
      `UID:recallo-reminder-${Date.now()}@recallo`,
      `DTSTAMP:${toIcsDate(now)}`,
      `DTSTART:${toIcsDate(start)}`,
      `DTEND:${toIcsDate(end)}`,
      'RRULE:FREQ=DAILY',
      `SUMMARY:${title}`,
      'DESCRIPTION:Time to review your Recallo flashcards.',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Time to review your Recallo flashcards.',
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

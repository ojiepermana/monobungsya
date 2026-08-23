import { Injectable } from '@angular/core';
import { toDataURL } from 'qrcode';

@Injectable({ providedIn: 'root' })
export class TotpQrService {
  dataUrl(value: string, width = 220): Promise<string> {
    return toDataURL(value, { margin: 1, width });
  }
}

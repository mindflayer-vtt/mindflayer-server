import { VTTMessage } from './vtt-message';

export interface VTTKeyEventMessage extends VTTMessage {
  type: 'key-event';
  'controller-id': string;
  key: string;
  state: 'down' | 'up';
}

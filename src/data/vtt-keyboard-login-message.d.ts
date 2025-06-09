import { VTTMessage } from './vtt-message';

export interface VTTKeyboardLoginMessage extends VTTMessage {
  type: 'keyboard-login';
  'controller-id': string;
  'player-id': string;
}

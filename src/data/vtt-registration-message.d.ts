import { VTTPlayer } from './vtt-player';
import { VTTMessage } from './vtt-message';

export interface VTTRegistrationMessage extends VTTMessage {
  type: 'registration';
  'controller-id': string | undefined;
  status: 'connected' | 'disconnected';
  receiver: boolean;
  players: VTTPlayer[] | undefined;
}

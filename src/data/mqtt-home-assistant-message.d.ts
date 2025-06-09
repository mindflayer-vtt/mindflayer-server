import { VTTMessage } from './vtt-message';
import { MQTTPlayer } from './mqtt-player';

export interface MQTTHomeAssistantMessage extends VTTMessage {
  type: 'mqttha';
  isInCombat: boolean;
  mood: string;
  players: MQTTPlayer[];
}

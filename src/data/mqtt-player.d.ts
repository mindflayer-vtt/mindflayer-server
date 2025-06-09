import { RGBColor } from './rgb-color';

export interface MQTTPlayer {
  playerId: string;
  controllerId: string;
  statusEffects: string[];
  color: RGBColor;
}

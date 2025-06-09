import { RGBColor } from './rgb-color';
import { VTTMessage } from './vtt-message';

export interface VTTConfigurationMessage extends VTTMessage {
  type: 'configuration';
  'controller-id': string;
  led1: RGBColor;
  led2: RGBColor;
}

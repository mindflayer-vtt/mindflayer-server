export interface VTTMessage {
  type:
    | 'key-event'
    | 'registration'
    | 'configuration'
    | 'keyboard-login'
    | 'ambilight'
    | 'mqttha';
}

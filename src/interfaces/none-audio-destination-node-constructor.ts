import { TNativeAudioNode } from '../types';
import { IAudioNode } from './audio-node';
import { IMinimalBaseAudioContext } from './minimal-base-audio-context';

export interface INoneAudioDestinationNodeConstructor {

    new (context: IMinimalBaseAudioContext, nativeNode: TNativeAudioNode): IAudioNode;

}

export { matchSentence } from './tracking.js';
import { issueSecret } from './services.js';

// A committed item identifies its predecessor. Completion responses may arrive in a different order.
export function orderedTranscripts(onComplete, onPartial = () => {}) {
  const items = new Map(),
    delivered = new Set();
  let last = null;
  function showNext() {
    const committed = [...items].filter(([, v]) => v.previous !== undefined);
    const next = committed.find(([, v]) => v.previous === last) ??
      (committed.length
        ? [...items].find(([key, v]) => v.previous === undefined &&
            committed.some(([, child]) => child.previous === key))
        : items.entries().next().value);
    if (!next) return;
    const [operation, item] = next;
    if (!item.partial || item.partial === item.shown || item.text !== undefined) return;
    item.shown = item.partial;
    onPartial({ operation, text: item.shown, partial: true });
  }
  return (message, observed) => {
    const key = message.item_id;
    if (
      key &&
      !delivered.has(key) &&
      message.type === 'conversation.item.input_audio_transcription.delta'
    ) {
      const item = items.get(key) || {};
      if (message.event_id) {
        item.revisions ??= new Set();
        if (item.revisions.has(message.event_id)) return;
        item.revisions.add(message.event_id);
      }
      item.partial = (item.partial ?? '') + (message.delta ?? '');
      items.set(key, item);
      showNext();
      return;
    }
    if (
      !key ||
      delivered.has(key) ||
      ![
        'input_audio_buffer.committed',
        'conversation.item.input_audio_transcription.completed',
      ].includes(message.type)
    )
      return;
    const item = items.get(key) || {};
    if (message.type === 'input_audio_buffer.committed') {
      item.previous = message.previous_item_id ?? null;
      item.observed = observed;
    } else item.text = message.transcript ?? '';
    items.set(key, item);
    while (true) {
      const next = [...items].find(
        ([, v]) => v.previous === last && v.text !== undefined,
      );
      if (!next) break;
      last = next[0];
      items.delete(last);
      delivered.add(last);
      onComplete({
        operation: last,
        text: next[1].text,
        observed: next[1].observed,
      });
    }
    showNext();
  };
}

// Prefer a short pause in the speaker's voice. Cap continuous speech as well.
export function speechCommitter() {
  let first = null, last = null, voicedFrames = 0;
  return (voicing, at) => {
    if (voicing) {
      first ??= at;
      last = at;
      voicedFrames++;
    }
    if (first === null) return false;
    const age = at - first, silence = at - last;
    if (silence < 320 && !(age >= 2400 && silence >= 180) && age < 4200) return false;
    const commit = voicedFrames >= 3;
    first = null;
    last = null;
    voicedFrames = 0;
    return commit;
  };
}
// Opening is cancellable even while the permission prompt or SDP exchange is pending.
export function voiceConnection(
  mode,
  { sample, now, result, lost, grantMock },
) {
  let stopped = false,
    pc,
    stream,
    channel,
    audio,
    timer;
  const abort = new AbortController();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    clearInterval(timer);
    channel?.close();
    pc?.close();
    stream?.getTracks().forEach((t) => t.stop());
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
  };
  async function start() {
    if (mode === 'mock') {
      await grantMock?.();
      if (stopped) return;
      timer = setInterval(() => {
        if (!stopped) sample();
      }, 4500);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error('마이크 연결에는 HTTPS 또는 localhost가 필요합니다.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      throw Error('연결을 취소했습니다.');
    }
    const secret = await issueSecret();
    if (stopped) throw Error('연결을 취소했습니다.');
    pc = new RTCPeerConnection();
    stream.getTracks().forEach((t) => {
      pc.addTrack(t, stream);
      t.onended = () => {
        if (!stopped) lost('마이크 입력이 중단됐습니다.', 'microphone');
      };
    });
    channel = pc.createDataChannel('oai-events');
    const commits = [],
      committedItems = new Set();
    const outstanding = new Map();
    const receive = orderedTranscripts((payload) => {
      outstanding.delete(payload.operation);
      result(payload);
    }, result);
    channel.onmessage = ({ data }) => {
      if (stopped) return;
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (
        msg.type === 'error' ||
        msg.type === 'conversation.item.input_audio_transcription.failed'
      )
        return lost(
          '전사 처리에 실패했습니다.',
          /timeout|server_error/.test(msg.error?.code ?? '')
            ? 'temporary'
            : 'configuration',
        );
      if (msg.type === 'session.closed')
        return lost('음성 세션이 종료됐습니다.', 'session');
      if (msg.type === 'conversation.item.input_audio_transcription.completed')
        outstanding.delete(msg.item_id);
      if (msg.type === 'input_audio_buffer.committed') {
        if (committedItems.has(msg.item_id)) return;
        committedItems.add(msg.item_id);
        const sent = commits.shift();
        outstanding.set(msg.item_id, performance.now());
        receive(msg, sent?.at);
      } else receive(msg);
    };
    const closed = () => {
      if (!stopped) lost('음성 연결이 끊겼습니다.', 'temporary');
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.connectionState)) closed();
    };
    channel.onclose = closed;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    });
    if (!answer.ok) throw Error('실시간 음성 연결에 실패했습니다.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
    if (channel.readyState !== 'open')
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => done(Error('음성 채널 응답 시간이 초과됐습니다.')),
          10000,
        );
        const cancel = () => done(Error('연결을 취소했습니다.'));
        function done(error) {
          clearTimeout(timeout);
          abort.signal.removeEventListener('abort', cancel);
          error ? reject(error) : resolve();
        }
        if (stopped) return cancel();
        channel.addEventListener('open', () => done(), { once: true });
        abort.signal.addEventListener('abort', cancel, { once: true });
      });
    audio = new AudioContext();
    await audio.resume();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    const shouldCommit = speechCommitter();
    let endAt;
    timer = setInterval(() => {
      if (stopped || channel.readyState !== 'open') return;
      const oldest = commits[0]?.sent ?? Infinity;
      if (
        performance.now() - Math.min(oldest, ...outstanding.values()) >
        15000
      ) {
        lost('보낸 음성에 대한 응답이 지연됐습니다.', 'temporary');
        return;
      }
      analyser.getFloatTimeDomainData(buffer);
      const rms = Math.sqrt(
        buffer.reduce((sum, x) => sum + x * x, 0) / buffer.length,
      );
      const voicing = rms > 0.015;
      if (voicing) endAt = now();
      if (shouldCommit(voicing, performance.now())) {
        commits.push({ at: endAt, sent: performance.now() });
        channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      }
    }, 50);
  }
  return { start, stop };
}

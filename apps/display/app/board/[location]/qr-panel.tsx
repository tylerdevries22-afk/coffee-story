import { formatCopy, type BrandCopy } from '@platform/ui/copy';
import { qrMatrix, qrSvgPath, qrViewBoxSize, QrEncodeError } from '@platform/domain';

/**
 * The one thing on this screen a guest can act on.
 *
 * A pickup board is otherwise pure output: nobody can tap it, so the only
 * conversion it can ever drive is a phone camera pointed at it while somebody
 * waits. That waiting is the whole opportunity -- it is the single moment in
 * the day when a guest is standing still, in the shop, with nothing to do.
 *
 * Rendered on the server, as one `<path>`. The matrix for a given URL never
 * changes, so re-encoding it in the browser every few seconds would be work
 * done to produce a byte-identical result; and a QR that is regenerated
 * client-side is a QR that is blank for the first frame after every reboot.
 */
export function QrPanel({ url, copy }: { url: string; copy: BrandCopy }) {
  let path: string;
  let size: number;
  try {
    const matrix = qrMatrix(url, 'M');
    path = qrSvgPath(matrix);
    size = qrViewBoxSize(matrix);
  } catch (error) {
    // A brand can configure a URL too long to encode. The panel disappears;
    // the board -- which is the actual job -- does not.
    if (error instanceof QrEncodeError) {
      console.error('display: QR not rendered', error.message);
      return null;
    }
    throw error;
  }

  return (
    <aside className="board-invite">
      <svg
        className="board-qr"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        // The URL, not "QR code": a screen reader on a phone held up to this
        // wall should read out the destination, which is the only useful
        // thing a non-camera can do with it.
        aria-label={url}
        shapeRendering="crispEdges"
      >
        <rect width={size} height={size} fill="var(--board-raised)" />
        <path d={path} fill="var(--board-primary)" />
      </svg>
      <div className="board-invite-words">
        {/*
          The headline breaks where the brand says it breaks.
          Left to the container it would turn wherever the viewport happened
          to put it, which on a portrait screen is a different place than on a
          landscape one -- and a three-stop headline that lands "Perks." /
          "Status. Rewards" has lost the rhythm that made it three stops.
        */}
        <p className="board-invite-title">
          {formatCopy(copy, 'boardQrTitle').split('\n').map((line, index) => (
            <span className="board-invite-line" key={index}>{line}</span>
          ))}
        </p>
        <p className="board-invite-body">
          {formatCopy(copy, 'boardQrBody', {
            appName: formatCopy(copy, 'appName'),
            pointsName: formatCopy(copy, 'pointsName'),
          })}
        </p>
      </div>
    </aside>
  );
}

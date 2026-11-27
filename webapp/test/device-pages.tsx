import { Route, Routes } from 'react-router';
import { DevicePage, SocketPage } from '@/screens/devices/DevicePage';
import { drawAt } from './harness';

/** A device's own page, the pages under it and the page of one of its sockets, at an address of theirs, as the app routes them. */
export const drawDevicePages = (at: string) =>
  drawAt(
    <Routes>
      <Route path="/devices/:deviceId/sockets/:socket" element={<SocketPage />} />
      <Route path="/devices/:deviceId/:page?" element={<DevicePage />} />
      <Route path="*" element={<p>elsewhere</p>} />
    </Routes>,
    { at },
  );

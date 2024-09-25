# 3D Gaussian splatting for Three.js

## Reference
- https://github.com/mkkellogg/GaussianSplats3D

## Controls
Mouse
- Left click to set the focal point
- Left click and drag to camera around the focal point
  
Keyboard
- `C` Toggles the mesh cursor, showing the intersection point of a mouse-projected ray and the splat mesh
- $\color{#DD6565}(ADD) After `C` Keydown and Left clicking at any point of view, you will move to the closest graph camera position$

- `I` Toggles an info panel that displays debugging info:
  - Camera position
  - Camera focal point/look-at point
  - Camera up vector
  - Mesh cursor position
  - Current FPS
  - Renderer window size
  - Ratio of rendered splats to total splats
  - Last splat sort duration

- `U` Toggles a debug object that shows the orientation of the camera controls. It includes a green arrow representing the camera's orbital axis and a white square representing the plane at which the camera's elevation angle is 0.

- `Left arrow` Rotate the camera's up vector counter-clockwise

- `Right arrow` Rotate the camera's up vector clockwise

- `P` Toggle point-cloud mode, where each splat is rendered as a filled circle

- `=` Increase splat scale

- `-` Decrease splat scale

- `O` Toggle orthographic mode

<br>

## Building from source and running locally
Navigate to the code directory and run
```
npm install
```
Next run the build. For Linux & Mac OS systems run:
```
npm run build
```
For Windows I have added a Windows-compatible version of the build command:
```
npm run build-windows
```
To view the demo scenes locally run
```
npm run demo
```
The demo will be accessible locally at [http://127.0.0.1:8080/index.html](http://127.0.0.1:8080/index.html). You will need to download the data for the demo scenes and extract them into 
```
<code directory>/build/demo/assets/data
```
The demo scene data is available here: [https://projects.markkellogg.org/downloads/gaussian_splat_data.zip](https://projects.markkellogg.org/downloads/gaussian_splat_data.zip)
<br>
<br>

## Installing as an NPM package
If you don't want to build the library from source, it is also available as an NPM package. The NPM package does not come with the source code or demos that are available in the source repository. To install, run the following command:
```
npm install @mkkellogg/gaussian-splats-3d
```

<br>

## Basic Usage

To run the built-in viewer:

```javascript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

const viewer = new GaussianSplats3D.Viewer({
    'cameraUp': [0, -1, -0.6],
    'initialCameraPosition': [-1, -4, 6],
    'initialCameraLookAt': [0, 4, 0]
});
viewer.addSplatScene('<path to .ply, .ksplat, or .splat file>', {
    'splatAlphaRemovalThreshold': 5,
    'showLoadingUI': true,
    'position': [0, 1, 0],
    'rotation': [0, 0, 0, 1],
    'scale': [1.5, 1.5, 1.5]
})
.then(() => {
    viewer.start();
});



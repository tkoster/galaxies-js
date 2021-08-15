function main() {
  let canvas = document.getElementById('output-canvas');
  let gl = canvas.getContext('webgl');
  if (gl === null) {
    alert('Sorry, this app uses WebGL and WebGL is not supported by your browser/system.');
    return;
  }

  let starsPerGalaxy = 40000;
  let galaxyA = createGalaxy(-1.0, 0, -0.5, starsPerGalaxy, false, 1.0, 0.5, 1.0);
  let galaxyB = createGalaxy(1.0, 0, 0.5, starsPerGalaxy, true, 0.5, 1.0, 1.0);

  let { program, attributes } = compilerShaders(gl);
  let galaxyABuffer = gl.createBuffer();
  let galaxyBBuffer = gl.createBuffer();

  let state = {
    zoom: 8,
    lat: 0.5,
    long: 0,
    targetZoom: 8,
    targetLat: 0.5,
    targetLong: 0,
    startTime: null,
    lastFrameTime: null,
    lastSimFrame: null,
    galaxyA,
    galaxyABuffer, 
    galaxyB,
    galaxyBBuffer,
    modelView: new Float32Array(16),
    projection: new Float32Array(16),
    program,
    attributes
  };

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.button === 0) {
      canvas.requestPointerLock();
    }
  });

  canvas.addEventListener('pointerup', e => {
    e.preventDefault();
    document.exitPointerLock();
  });

  canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    if (e.buttons & 1 !== 0) {
      state.targetLat += e.movementY / 100;
      state.targetLong += e.movementX / 100;
    }
  });

  canvas.addEventListener('wheel', e => {
    if (e.deltaY > 0) {
      ++state.targetZoom;
    } else if (e.deltaY < 0) {
      --state.targetZoom;
    }
  });

  function frame(t) {
    update(state, t);
    draw(state, gl);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function update(state, t) {
  let tSec = t / 1000.0; // t is milliseconds

  let lastFrameTime = state.lastFrameTime === null ? tSec : state.lastFrameTime;
  let dt = tSec - lastFrameTime;
  state.lastFrameTime = tSec;

  if (state.startTime === null || dt > 0.2) {
    // More than 200ms between frames very likely means the browser process was
    // paused because it went into the background. Instead of attempting to
    // catch up the simulation for the entire interval (it may never catch up),
    // just reset the timers. To users it will appear as if the simulation was
    // paused while the browser process was in the background.
    state.startTime = tSec;
    state.lastSimFrame = -1;
  }

  let currentTime = tSec - state.startTime;

  // The numerical characteristics of the simulation are dependent on the size
  // of the time step so it is important that the time step is fixed. We can't
  // use the time elapsed between graphics frames as the simulation time step.
  // Instead, we attempt to run approx 120 simulation frames per second
  // regardless of the monitor refresh rate.
  //
  // The number of simulations per graphics frame is capped at 8. If more than
  // 8 simulation frames per graphics frame are required then the performance
  // is too poor to keep up. The effect is that the simulation appears to slow
  // down.

  let simulationTimeStep = 0.0005;
  let simulationFrequency = 120;
  let currentSimFrame = Math.trunc(currentTime * simulationFrequency);
  let numFramesToSim = currentSimFrame - state.lastSimFrame;
  if (numFramesToSim > 8) {
    numFramesToSim = 8;
  }

  while (numFramesToSim > 0) {
    updateGalaxy(state.galaxyA, state.galaxyB, simulationTimeStep);
    updateGalaxy(state.galaxyB, state.galaxyA, simulationTimeStep);
    --numFramesToSim;
  }
  state.lastSimFrame = currentSimFrame;

  // Smoothly interpolate the camera parameters:
  state.zoom = state.zoom + (state.targetZoom - state.zoom) * dt * 8;
  state.lat = state.lat + (state.targetLat - state.lat) * dt * 4;
  state.long = state.long + (state.targetLong - state.long) * dt * 4;
}

function draw(state, gl) {
  let distance = Math.pow(1.2, state.zoom);
  identity(state.modelView);
  translate(state.modelView, 0, 0, -distance);
  rotateX(state.modelView, state.lat - Math.PI / 2);
  rotateZ(state.modelView, state.long);

  let fov = 45 * Math.PI / 180;
  let aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
  let zNear = 0.1;
  let zFar = 100.0;
  perspectiveProjection(state.projection, fov, aspect, zNear, zFar);

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.enable(gl.BLEND);
  gl.useProgram(state.program);
  gl.uniformMatrix4fv(state.attributes.projection, false, state.projection);
  gl.uniformMatrix4fv(state.attributes.modelView, false, state.modelView);

  drawGalaxy(gl, state.attributes, state.galaxyA, state.galaxyABuffer);
  drawGalaxy(gl, state.attributes, state.galaxyB, state.galaxyBBuffer);
}

function drawGalaxy(gl, attributes, galaxy, buffer) {
  gl.uniform4fv(attributes.color, galaxy.color);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, galaxy.positions, gl.STREAM_DRAW);
  gl.vertexAttribPointer(attributes.pos, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(attributes.pos);
  gl.drawArrays(gl.POINTS, 0, galaxy.numStars);
}

function compilerShaders(gl) {
  let vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    alert('Error in vertex shader: ' + gl.getShaderInfoLog(vertexShader));
  }

  let fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    alert('Error in fragment shader: ' + gl.getShaderInfoLog(fragmentShader));
  }

  let program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    alert('Error in shader program: ' + gl.getProgramInfoLog(program));
  }

  let attributes = {
    position: gl.getAttribLocation(program, 'position'),
    color: gl.getUniformLocation(program, 'color'),
    modelView: gl.getUniformLocation(program, 'modelView'),
    projection: gl.getUniformLocation(program, 'projection')
  };

  return { vertexShader, fragmentShader, program, attributes };
}

function createGalaxy(x, y, z, numStars, invert, r, g, b) {
  let positions = new Float32Array(4 * numStars);
  let velocities = new Float32Array(3 * numStars);
  let color = new Float32Array([r, g, b, 1.0]);
  for (let i = 0; i < numStars; ++i) {
    // Star mass:
    let m = (1.0 + Math.random()) / 2;

    // Star position:
    let w = Math.random() * 2 * Math.PI;
    let r = 0.01 + Math.pow(Math.random(), 2);
    let a = 4 * Math.PI * r;
    let h = Math.random() * (0.01 + 0.2 * Math.sin(a) / a);
    let starX = r * Math.cos(w);
    let starY = r * Math.sin(w);
    let starZ = h * (Math.random() < 0.5 ? -1 : 1);

    // Star velocity:
    let actualR = Math.sqrt(r * r + h * h);
    let tangentV = (invert ? 1 : -1) * Math.sqrt(m / actualR);
    let starXVel = tangentV * Math.cos(w - Math.PI / 2);
    let starYVel = tangentV * Math.sin(w - Math.PI / 2);
    let starZVel = 0;

    positions[4 * i + 0] = x + starX;
    positions[4 * i + 1] = y + starY;
    positions[4 * i + 2] = z + starZ;
    positions[4 * i + 3] = m;
    velocities[3 * i + 0] = starXVel;
    velocities[3 * i + 1] = starYVel;
    velocities[3 * i + 2] = starZVel;
  }
  return {
    x, y, z,
    numStars,
    positions,
    velocities,
    color
  };
}

function updateGalaxy(galaxy, otherGalaxy, dt) {
  let { numStars, positions, velocities } = galaxy;
  for (let i = 0; i < numStars; ++i) {
    let x0 = positions[4 * i + 0];
    let y0 = positions[4 * i + 1];
    let z0 = positions[4 * i + 2];
    let m  = positions[4 * i + 3];

    // Acceleration:
    let irx = x0 - galaxy.x;
    let iry = y0 - galaxy.y;
    let irz = z0 - galaxy.z;
    let ir = Math.sqrt(irx * irx + iry * iry + irz * irz);
    let ircube = ir * ir * ir;
    let iax = -irx * m / ircube;
    let iay = -iry * m / ircube;
    let iaz = -irz * m / ircube;
    let orx = x0 - otherGalaxy.x;
    let ory = y0 - otherGalaxy.y;
    let orz = z0 - otherGalaxy.z;
    let or = Math.sqrt(orx * orx + ory * ory + orz * orz);
    let orcube = or * or * or;
    let oax = -orx * m / orcube;
    let oay = -ory * m / orcube;
    let oaz = -orz * m / orcube;
    let ax = iax + 2 * oax;
    let ay = iay + 2 * oay;
    let az = iaz + 2 * oaz;

    // Velocity:
    let vx = velocities[3 * i + 0] + ax * dt;
    let vy = velocities[3 * i + 1] + ay * dt;
    let vz = velocities[3 * i + 2] + az * dt;

    // Position:
    let x = x0 + vx * dt;
    let y = y0 + vy * dt;
    let z = z0 + vz * dt;

    positions[4 * i + 0] = x;
    positions[4 * i + 1] = y;
    positions[4 * i + 2] = z;
    velocities[3 * i + 0] = vx;
    velocities[3 * i + 1] = vy;
    velocities[3 * i + 2] = vz;
  }
}

function identity(matrix) {
  matrix[0] = 1;
  matrix[1] = 0;
  matrix[2] = 0;
  matrix[3] = 0;
  matrix[4] = 0;
  matrix[5] = 1;
  matrix[6] = 0;
  matrix[7] = 0;
  matrix[8] = 0;
  matrix[9] = 0;
  matrix[10] = 1;
  matrix[11] = 0;
  matrix[12] = 0;
  matrix[13] = 0;
  matrix[14] = 0;
  matrix[15] = 1;
}

function translate(matrix, x, y, z) {
  matrix[12] += matrix[0] * x + matrix[4] * y + matrix[8] * z;
  matrix[13] += matrix[1] * x + matrix[5] * y + matrix[9] * z;
  matrix[14] += matrix[2] * x + matrix[6] * y + matrix[10] * z;
  matrix[15] += matrix[3] * x + matrix[7] * y + matrix[11] * z;
}

function rotateX(matrix, angle) {
  let c = Math.cos(angle);
  let s = Math.sin(angle);
  let m4 = matrix[4];
  let m5 = matrix[5];
  let m6 = matrix[6];
  let m7 = matrix[7];
  let m8 = matrix[8];
  let m9 = matrix[9];
  let m10 = matrix[10];
  let m11 = matrix[11];
  matrix[4]  = m4  * c + m8  * s;
  matrix[5]  = m5  * c + m9  * s;
  matrix[6]  = m6  * c + m10 * s;
  matrix[7]  = m7  * c + m11 * s;
  matrix[8]  = m8  * c - m4  * s;
  matrix[9]  = m9  * c - m5  * s;
  matrix[10] = m10 * c - m6  * s;
  matrix[11] = m11 * c - m7  * s;
}

function rotateY(matrix, angle) {
  let c = Math.cos(angle);
  let s = Math.sin(angle);
  let m0 = matrix[0];
  let m1 = matrix[1];
  let m2 = matrix[2];
  let m3 = matrix[3];
  let m8 = matrix[8];
  let m9 = matrix[9];
  let m10 = matrix[10];
  let m11 = matrix[11];
  matrix[0]  = m0 * c - m8  * s;
  matrix[1]  = m1 * c - m9  * s;
  matrix[2]  = m2 * c - m10 * s;
  matrix[3]  = m3 * c - m11 * s;
  matrix[8]  = m0 * s + m8  * c;
  matrix[9]  = m1 * s + m9  * c;
  matrix[10] = m2 * s + m10 * c;
  matrix[11] = m3 * s + m11 * c;
}

function rotateZ(matrix, angle) {
  let c = Math.cos(angle);
  let s = Math.sin(angle);
  let m0 = matrix[0];
  let m1 = matrix[1];
  let m2 = matrix[2];
  let m3 = matrix[3];
  let m4 = matrix[4];
  let m5 = matrix[5];
  let m6 = matrix[6];
  let m7 = matrix[7];
  matrix[0] = m0 * c + m4 * s;
  matrix[1] = m1 * c + m5 * s;
  matrix[2] = m2 * c + m6 * s;
  matrix[3] = m3 * c + m7 * s;
  matrix[4] = m4 * c - m0 * s;
  matrix[5] = m5 * c - m1 * s;
  matrix[6] = m6 * c - m2 * s;
  matrix[7] = m7 * c - m3 * s;
}

function perspectiveProjection(matrix, fov, aspect, zNear, zFar) {
  let f = 1.0 / Math.tan(fov / 2.0);
  matrix[0] = f / aspect;
  matrix[1] = 0;
  matrix[2] = 0;
  matrix[3] = 0;
  matrix[4] = 0;
  matrix[5] = f;
  matrix[6] = 0;
  matrix[7] = 0;
  matrix[8] = 0;
  matrix[9] = 0;
  matrix[10] = (zNear + zFar) / (zNear - zFar);
  matrix[11] = -1;
  matrix[12] = 0;
  matrix[13] = 0;
  matrix[14] = 2 * zNear * zFar / (zNear - zFar);
  matrix[15] = 0;
}

const vertexShaderSource = `
  attribute vec4 position;
  uniform vec4 color;
  uniform mat4 modelView;
  uniform mat4 projection;

  varying lowp vec4 pointColor;

  void main() {
    float mass = position.w;
    vec4 p = position;
    p.w = 1.0;

    gl_PointSize = 2.0;
    gl_Position = projection * modelView * p;
    pointColor = color * mass;
  }
`;

const fragmentShaderSource = `
  varying lowp vec4 pointColor;

  void main() {
    gl_FragColor = pointColor * vec4(1.0, 1.0, 1.0, 0.15);
  }
`;

main();

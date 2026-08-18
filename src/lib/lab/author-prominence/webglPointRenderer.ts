import type { ProjectionTransform } from './camera';

export interface RendererMetrics {
	baseUploads: number;
	rankingUploads: number;
	selectionUploads: number;
	frames: number;
}

const vertexSource = `#version 300 es
in vec3 a_position;
uniform float u_css_width;
uniform float u_css_height;
uniform float u_dpr;
uniform float u_pan_x;
uniform float u_pan_y;
uniform float u_cos_azimuth;
uniform float u_sin_azimuth;
uniform float u_cos_elevation;
uniform float u_sin_elevation;
uniform float u_base_scale;
uniform float u_domain;
uniform float u_perspective_factor;
uniform float u_point_size;
uniform vec4 u_colour;
out float v_depth;
void main() {
  vec3 p = a_position / max(u_domain, 0.001);
  float horizontal = u_cos_azimuth * p.x - u_sin_azimuth * p.y;
  float depth_plane = u_sin_azimuth * p.x + u_cos_azimuth * p.y;
  float vertical = u_cos_elevation * p.z - u_sin_elevation * depth_plane;
  float depth = u_cos_elevation * depth_plane + u_sin_elevation * p.z;
  float perspective = 1.0 / (1.0 + depth * u_perspective_factor);
  float screen_x = u_css_width * 0.5 + u_pan_x + horizontal * u_base_scale * perspective;
  float screen_y = u_css_height * 0.5 + u_pan_y - vertical * u_base_scale * perspective;
  float device_width = u_css_width * u_dpr;
  float device_height = u_css_height * u_dpr;
  float device_x = screen_x * u_dpr;
  float device_y = screen_y * u_dpr;
  gl_Position = vec4(
    device_x / device_width * 2.0 - 1.0,
    1.0 - device_y / device_height * 2.0,
    depth * 0.08,
    1.0
  );
  gl_PointSize = u_point_size * perspective;
  v_depth = depth;
}`;

const fragmentSource = `#version 300 es
precision highp float;
uniform vec4 u_colour;
out vec4 out_colour;
void main() {
  vec2 point = gl_PointCoord - vec2(0.5);
  if (dot(point, point) > 0.25) discard;
  out_colour = u_colour;
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Unable to create WebGL shader.');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? 'Unknown WebGL shader error.';
		gl.deleteShader(shader);
		throw new Error(log);
	}
	return shader;
}

function pointPositions(source: Float64Array[], indices: ArrayLike<number>): Float32Array {
	const result = new Float32Array(indices.length * 3);
	for (let position = 0; position < indices.length; position++) {
		const index = indices[position];
		result[position * 3] = source[0][index] ?? 0;
		result[position * 3 + 1] = source[1][index] ?? 0;
		result[position * 3 + 2] = source[2][index] ?? 0;
	}
	return result;
}

function allPointPositions(source: Float64Array[]): Float32Array {
	const count = source[0]?.length ?? 0;
	const result = new Float32Array(count * 3);
	for (let index = 0; index < count; index++) {
		result[index * 3] = source[0][index] ?? 0;
		result[index * 3 + 1] = source[1][index] ?? 0;
		result[index * 3 + 2] = source[2][index] ?? 0;
	}
	return result;
}

/** WebGL2 point cloud; labels, axes and controls remain in the CSS-pixel overlay. */
export class WebGLPointRenderer {
	readonly gl: WebGL2RenderingContext;
	private readonly program: WebGLProgram;
	private readonly positionLocation: number;
	private readonly uniforms: Record<string, WebGLUniformLocation | null>;
	private readonly baseBuffer: WebGLBuffer;
	private readonly top250Buffer: WebGLBuffer;
	private readonly leadersBuffer: WebGLBuffer;
	private readonly selectedBuffer: WebGLBuffer;
	private readonly baseCount: number;
	private top250Count = 0;
	private leadersCount = 0;
	private selectedCount = 0;
	private metrics: RendererMetrics = {
		baseUploads: 0,
		rankingUploads: 0,
		selectionUploads: 0,
		frames: 0
	};

	constructor(canvas: HTMLCanvasElement, source: Float64Array[]) {
		const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
		if (!gl) throw new Error('WebGL2 is unavailable.');
		this.gl = gl;
		const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
		const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
		const program = gl.createProgram();
		if (!program) throw new Error('Unable to create WebGL program.');
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS))
			throw new Error(gl.getProgramInfoLog(program) ?? 'Unable to link WebGL program.');
		this.program = program;
		this.positionLocation = gl.getAttribLocation(program, 'a_position');
		this.uniforms = Object.fromEntries(
			[
				'u_css_width',
				'u_css_height',
				'u_dpr',
				'u_pan_x',
				'u_pan_y',
				'u_cos_azimuth',
				'u_sin_azimuth',
				'u_cos_elevation',
				'u_sin_elevation',
				'u_base_scale',
				'u_domain',
				'u_perspective_factor',
				'u_point_size',
				'u_colour'
			].map((name) => [name, gl.getUniformLocation(program, name)])
		);
		const buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
		if (buffers.some((buffer) => !buffer)) throw new Error('Unable to create WebGL buffers.');
		[this.baseBuffer, this.top250Buffer, this.leadersBuffer, this.selectedBuffer] =
			buffers as WebGLBuffer[];
		const positions = allPointPositions(source);
		this.baseCount = source[0]?.length ?? 0;
		this.upload(this.baseBuffer, positions, 'base');
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}

	private upload(
		buffer: WebGLBuffer,
		positions: Float32Array,
		kind: 'base' | 'ranking' | 'selection'
	): void {
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, positions, kind === 'base' ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
		if (kind === 'base') this.metrics.baseUploads += 1;
		if (kind === 'ranking') this.metrics.rankingUploads += 1;
		if (kind === 'selection') this.metrics.selectionUploads += 1;
	}

	/** Upload the population leaders only when an authoritative ranking changes. */
	updateRankingOverlays(
		top250: ArrayLike<number>,
		leaders: ArrayLike<number>,
		source: Float64Array[]
	): void {
		this.upload(this.top250Buffer, pointPositions(source, top250), 'ranking');
		this.upload(this.leadersBuffer, pointPositions(source, leaders), 'ranking');
		this.top250Count = top250.length;
		this.leadersCount = leaders.length;
	}

	/** Upload the selected author only when selection changes. */
	updateSelection(selectedIndex: number | null, source: Float64Array[]): void {
		if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= this.baseCount) {
			this.selectedCount = 0;
			return;
		}
		this.upload(this.selectedBuffer, pointPositions(source, [selectedIndex]), 'selection');
		this.selectedCount = 1;
	}

	resize(width: number, height: number, dpr: number): void {
		this.gl.canvas.width = Math.max(1, Math.round(width * dpr));
		this.gl.canvas.height = Math.max(1, Math.round(height * dpr));
	}

	render(projection: ProjectionTransform): void {
		const gl = this.gl;
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
		gl.clearColor(0.031, 0.063, 0.063, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.useProgram(this.program);
		gl.uniform1f(this.uniforms.u_css_width, projection.width);
		gl.uniform1f(this.uniforms.u_css_height, projection.height);
		gl.uniform1f(this.uniforms.u_dpr, projection.dpr);
		gl.uniform1f(this.uniforms.u_pan_x, projection.camera.panX);
		gl.uniform1f(this.uniforms.u_pan_y, projection.camera.panY);
		gl.uniform1f(this.uniforms.u_cos_azimuth, projection.cosAzimuth);
		gl.uniform1f(this.uniforms.u_sin_azimuth, projection.sinAzimuth);
		gl.uniform1f(this.uniforms.u_cos_elevation, projection.cosElevation);
		gl.uniform1f(this.uniforms.u_sin_elevation, projection.sinElevation);
		gl.uniform1f(this.uniforms.u_base_scale, projection.baseScale);
		gl.uniform1f(this.uniforms.u_domain, projection.domain);
		gl.uniform1f(this.uniforms.u_perspective_factor, projection.perspectiveFactor);
		const dpr = projection.dpr;
		this.draw(this.baseBuffer, this.baseCount, 2.2 * dpr, [0.66, 0.77, 0.78, 0.22]);
		this.draw(this.top250Buffer, this.top250Count, 3.6 * dpr, [0.56, 0.85, 0.76, 0.42]);
		this.draw(this.leadersBuffer, this.leadersCount, 4.6 * dpr, [0.95, 0.8, 0.39, 0.74]);
		this.draw(this.selectedBuffer, this.selectedCount, 8 * dpr, [0.94, 1, 1, 1]);
		this.metrics.frames += 1;
	}

	private draw(
		buffer: WebGLBuffer,
		count: number,
		size: number,
		colour: [number, number, number, number]
	): void {
		if (count === 0) return;
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.enableVertexAttribArray(this.positionLocation);
		gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);
		gl.uniform1f(this.uniforms.u_point_size, size);
		gl.uniform4f(this.uniforms.u_colour, ...colour);
		gl.drawArrays(gl.POINTS, 0, count);
	}

	getMetrics(): RendererMetrics {
		return { ...this.metrics };
	}

	destroy(): void {
		this.gl.deleteProgram(this.program);
		this.gl.deleteBuffer(this.baseBuffer);
		this.gl.deleteBuffer(this.top250Buffer);
		this.gl.deleteBuffer(this.leadersBuffer);
		this.gl.deleteBuffer(this.selectedBuffer);
	}
}

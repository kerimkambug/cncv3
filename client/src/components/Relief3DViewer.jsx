import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function Relief3DViewer({
  depthGrid,
  gridCols,
  gridRows,
  realWidth = 200,
  realHeight = 200,
  maxDepth = 5,
}) {
  const containerRef = useRef(null);
  const [materialType, setMaterialType] = useState('grayscale'); // 'grayscale' | 'marble' | 'clay' | 'wood' | 'gold'
  const [depthScale, setDepthScale] = useState(1.0);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const meshRef = useRef(null);
  const controlsRef = useRef(null);
  const lightRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !depthGrid || gridCols <= 0 || gridRows <= 0) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 340;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12141a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 3. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xfffaed, 1.8);
    dirLight1.position.set(realWidth * 0.8, -realHeight * 0.6, 120);
    dirLight1.castShadow = true;
    scene.add(dirLight1);
    lightRef.current = dirLight1;

    const dirLight2 = new THREE.DirectionalLight(0x8cb4ff, 0.6);
    dirLight2.position.set(-realWidth * 0.8, realHeight * 0.8, 60);
    scene.add(dirLight2);

    // 5. Plane Mesh with vertex displacement
    // 4K depth ızgarasında daha pürüzsüz önizleme için segment sayısı arttırıldı.
    const segX = Math.min(512, gridCols - 1);
    const segY = Math.min(512, gridRows - 1);
    const geometry = new THREE.PlaneGeometry(realWidth, realHeight, segX, segY);
    const fitDistance = Math.max(realWidth, realHeight) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.2;
    camera.position.set(0, -fitDistance * 0.28, fitDistance);
    controls.minDistance = Math.max(10, fitDistance * 0.35);
    controls.maxDistance = fitDistance * 4;
    controls.update();

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + realWidth / 2) / realWidth;
      const v = (pos.getY(i) + realHeight / 2) / realHeight;

      const c = Math.max(0, Math.min(gridCols - 1, Math.round(u * (gridCols - 1))));
      const r = Math.max(0, Math.min(gridRows - 1, Math.round((1 - v) * (gridRows - 1))));
      const d = depthGrid[r * gridCols + c] || 0;

      // Z displacement: d=1.0 (en yüksek tepe / beyaz), d=0.0 (en derin taban / siyah)
      pos.setZ(i, d * maxDepth * depthScale);
    }
    geometry.computeVertexNormals();

    const mat = createMaterial(materialType, wireframe);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshRef.current = mesh;

    // Animation Loop
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (autoRotate && meshRef.current) {
        meshRef.current.rotation.z += 0.004;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      renderer.dispose();
      geometry.dispose();
    };
  }, [depthGrid, gridCols, gridRows, realWidth, realHeight, maxDepth, depthScale]);

  // Update Material dynamically
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.material.dispose();
      meshRef.current.material = createMaterial(materialType, wireframe);
    }
  }, [materialType, wireframe]);

  function createMaterial(type, isWireframe) {
    switch (type) {
      case 'grayscale':
        return new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          metalness: 0.1,
          roughness: 0.35,
          side: THREE.DoubleSide,
          wireframe: isWireframe,
        });
      case 'marble':
        return new THREE.MeshStandardMaterial({
          color: 0xffffff,
          metalness: 0.05,
          roughness: 0.25,
          side: THREE.DoubleSide,
          wireframe: isWireframe,
        });
      case 'clay':
        return new THREE.MeshStandardMaterial({
          color: 0xcc7a52,
          metalness: 0.0,
          roughness: 0.85,
          side: THREE.DoubleSide,
          wireframe: isWireframe,
        });
      case 'wood':
        return new THREE.MeshStandardMaterial({
          color: 0x96613d,
          metalness: 0.05,
          roughness: 0.65,
          side: THREE.DoubleSide,
          wireframe: isWireframe,
        });
      case 'gold':
        return new THREE.MeshStandardMaterial({
          color: 0xd4af37,
          metalness: 0.75,
          roughness: 0.32,
          side: THREE.DoubleSide,
          wireframe: isWireframe,
        });
      default:
        return new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          metalness: 0.1,
          roughness: 0.35,
          side: THREE.DoubleSide,
          wireframe: isWireframe,
        });
    }
  }

  function handleResetCamera() {
    if (controlsRef.current && meshRef.current) {
      meshRef.current.rotation.z = 0;
      controlsRef.current.reset();
    }
  }

  async function toggleFullscreen() {
    const wrapper = containerRef.current?.parentElement;
    if (!wrapper) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapper.requestFullscreen();
  }

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div className="relief-3d-wrapper">
      <div className="relief-3d-toolbar">
        <div className="toolbar-group">
          <label>Malzeme:</label>
          <select value={materialType} onChange={(e) => setMaterialType(e.target.value)}>
            <option value="grayscale">🖤 Nötr Gri Ton (Grayscale)</option>
            <option value="marble">🏛️ Beyaz Mermer / Alçı</option>
            <option value="clay">🏺 Heykeltıraş Kili</option>
            <option value="wood">🪵 Ahşap / Meşe</option>
            <option value="gold">🏆 Antik Altın / Pirinç</option>
          </select>
        </div>

        <div className="toolbar-group">
          <label>Derinlik Gücü:</label>
          <select value={depthScale} onChange={(e) => setDepthScale(parseFloat(e.target.value))}>
            <option value={0.5}>0.5x (Hafif)</option>
            <option value={1.0}>1.0x (Normal)</option>
            <option value={1.5}>1.5x (Belirgin)</option>
            <option value={2.0}>2.0x (Derin)</option>
          </select>
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className={`btn-small ${wireframe ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setWireframe((v) => !v)}
          >
            🕸️ Tel Kafes
          </button>
          <button
            type="button"
            className={`btn-small ${autoRotate ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAutoRotate((v) => !v)}
          >
            🔄 Döndür
          </button>
          <button type="button" className="btn-small btn-secondary" onClick={handleResetCamera}>
            🎯 Sıfırla
          </button>
          <button type="button" className="btn-small btn-secondary" onClick={toggleFullscreen}>
            {isFullscreen ? '↙ Küçült' : '⛶ Tam ekran'}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relief-3d-canvas-container" />
      <div className="relief-3d-hint">
        💡 <b>Kullanım:</b> Sol Tık + Sürükle: 3D Döndür | Sağ Tık + Sürükle: Kaydır | Tekerlek: Yakınlaş
      </div>
    </div>
  );
}

import SwiftUI
import AVKit
import WebKit

struct Channel: Decodable { let items: [Tape] }
struct Tape: Decodable, Identifiable {
    struct Source: Decodable { let kind: String; let id_or_url: String; let file: String? }
    let id: String
    let title: String
    let year: Int?
    let play: [Source]?
    var thumbnail: URL? {
        guard let source = play?.first(where: { $0.kind == "youtube" }) else { return nil }
        return URL(string: "https://i.ytimg.com/vi/\(source.id_or_url)/hqdefault.jpg")
    }
    var archiveURL: URL? {
        guard let s = play?.first(where: { $0.kind == "archive" && $0.file != nil }),
              let file = s.file, ["mp4", "m4v", "mov"].contains(URL(fileURLWithPath: file).pathExtension.lowercased()), !file.split(separator: "/").contains(".."),
              s.id_or_url.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil else { return nil }
        var url = URL(string: "https://archive.org/download/")!.appendingPathComponent(s.id_or_url)
        for component in file.split(separator: "/") { url.appendPathComponent(String(component)) }
        return url
    }
}

@main struct PlebflixApp: App { var body: some Scene { WindowGroup { Home() } } }
struct Home: View {
    @State private var channel = "international"
    @State private var tapes: [Tape] = []
    @State private var error: String?
    @State private var saved: [URL] = []
    @State private var downloading: String?
    var folder: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Offline", isDirectory: true) }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Channel", selection: $channel) { Text("International").tag("international"); Text("Suomi").tag("suomi") }.pickerStyle(.segmented)
                }
                Section("Curated videos") {
                    ForEach(tapes) { tape in
                        NavigationLink { TapeView(tape: tape, save: { await save(tape) }, downloading: downloading == tape.id) } label: {
                            HStack { AsyncImage(url: tape.thumbnail) { image in image.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.2) }.frame(width: 100, height: 60).clipped(); VStack(alignment: .leading) { Text(tape.title); if let year = tape.year { Text(String(year)).font(.caption).foregroundStyle(.secondary) } } }
                        }
                    }
                }
                Section("Offline library") {
                    ForEach(saved, id: \.self) { url in HStack { NavigationLink(url.deletingPathExtension().lastPathComponent) { VideoPlayer(player: AVPlayer(url: url)).navigationTitle(url.lastPathComponent) }; ShareLink(item: url) } }
                    if saved.isEmpty { Text("Saved videos appear here.").foregroundStyle(.secondary) }
                }
                if let error { Section { Text(error).foregroundStyle(.secondary) } }
            }.navigationTitle("Plebflix").task(id: channel) { await load() }.onAppear { refreshSaved() }
        }
    }
    func load() async {
        do {
            let requested = channel
            let (data, response) = try await URLSession.shared.data(from: URL(string: "https://plebflix.com/channels/\(requested).json")!)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let result = try JSONDecoder().decode(Channel.self, from: data)
            guard channel == requested else { return }
            tapes = result.items; error = nil
        } catch { self.error = "Could not load the Plebflix catalogue: \(error.localizedDescription)" }
    }
    func refreshSaved() { saved = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil))?.filter { !$0.hasDirectoryPath }.sorted { $0.lastPathComponent < $1.lastPathComponent } ?? [] }
    func save(_ tape: Tape) async {
        guard let source = tape.archiveURL else { return }
        downloading = tape.id; defer { downloading = nil }
        do {
            let (temporary, response) = try await URLSession.shared.download(from: source)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let ext = source.pathExtension.isEmpty ? "mp4" : source.pathExtension
            let destination = folder.appendingPathComponent(tape.id).appendingPathExtension(ext)
            if FileManager.default.fileExists(atPath: destination.path) { error = "This video is already saved."; return }
            try FileManager.default.moveItem(at: temporary, to: destination)
            refreshSaved(); error = nil
        } catch { self.error = "Download failed: \(error.localizedDescription)" }
    }
}
struct TapeView: View {
    let tape: Tape
    let save: () async -> Void
    let downloading: Bool
    var body: some View {
        VStack(spacing: 20) {
            if let s = tape.play?.first(where: { $0.kind == "youtube" }), s.id_or_url.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil {
                YouTubePlayer(id: s.id_or_url).aspectRatio(16/9, contentMode: .fit)
            } else if let url = tape.archiveURL { VideoPlayer(player: AVPlayer(url: url)).aspectRatio(16/9, contentMode: .fit) }
            if tape.archiveURL != nil { Button(downloading ? "Saving…" : "Save for offline") { Task { await save() } }.disabled(downloading) }
            Spacer()
        }.padding().navigationTitle(tape.title).navigationBarTitleDisplayMode(.inline)
    }
}
struct YouTubePlayer: UIViewRepresentable {
    let id: String
    func makeUIView(context: Context) -> WKWebView { let view = WKWebView(); view.loadHTMLString("""
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/\(id)" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></body></html>
""", baseURL: URL(string: "https://plebflix.com/")); return view }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

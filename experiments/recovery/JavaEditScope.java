import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.Trees;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

/** Trusted, parse-only controller helper. Never analyzes, generates or loads candidate classes. */
public class JavaEditScope {
  public static void main(String[] args) throws Exception {
    var source = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    var file = new SimpleJavaFileObject(URI.create("string:///GuardedToolMethods.java"), JavaFileObject.Kind.SOURCE) {
      @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return source; }
    };
    var compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) throw new IllegalStateException("JDK required");
    try (var manager = compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
      var task = (JavacTask) compiler.getTask(null, manager, diagnostics,
          List.of("--release", "21", "-proc:none"), null, List.of(file));
      var units = task.parse().iterator();
      CompilationUnitTree unit = units.next();
      if (units.hasNext() || diagnostics.getDiagnostics().stream().anyMatch(d -> d.getKind() == Diagnostic.Kind.ERROR)) {
        throw new IllegalArgumentException("Invalid Java");
      }
      if (unit.getTypeDecls().size() != 1 || !(unit.getTypeDecls().get(0) instanceof ClassTree owner)
          || !owner.getSimpleName().contentEquals("GuardedToolMethods")) {
        throw new IllegalArgumentException("Unexpected Java type");
      }
      var positions = Trees.instance(task).getSourcePositions();
      if (unit.getImports().isEmpty()) throw new IllegalArgumentException("Expected baseline imports");
      long importEnd = positions.getEndPosition(unit, unit.getImports().getLast());
      var json = new StringBuilder("{\"importEnd\":" + importEnd + ",\"importCount\":" + unit.getImports().size()
          + ",\"memberCount\":" + owner.getMembers().size());
      for (var name : List.of("fromAnnotated", "create")) {
        var methods = owner.getMembers().stream().filter(m -> m instanceof MethodTree method && method.getName().contentEquals(name)).toList();
        if (methods.size() != 1 || ((MethodTree) methods.getFirst()).getBody() == null) {
          throw new IllegalArgumentException("Expected one method body");
        }
        var body = ((MethodTree) methods.getFirst()).getBody();
        long start = positions.getStartPosition(unit, body);
        long end = positions.getEndPosition(unit, body);
        if (start < 0 || end <= start || end > source.length() || source.charAt((int) start) != '{' || source.charAt((int) end - 1) != '}') {
          throw new IllegalArgumentException("Invalid method positions");
        }
        json.append(",\"").append(name).append("\":{\"bodyStart\":").append(start).append(",\"bodyEnd\":").append(end).append('}');
      }
      System.out.println(json.append('}'));
    }
  }
}
